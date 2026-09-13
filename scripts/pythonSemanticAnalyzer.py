import ast, hashlib, json, os, platform, sys

root = os.path.abspath(sys.argv[1])
project_id = sys.argv[2]
files = sys.argv[3:]
source_names = {'request', 'req', 'body', 'query', 'params', 'input', 'user_input', 'stdin'}
sink_names = {'eval', 'exec', 'system', 'popen', 'run', 'call', 'execute', 'raw'}
functions, calls, findings, file_records = {}, [], [], []

def digest(text): return hashlib.sha256(text.encode('utf-8')).hexdigest()
def safe_file(relative):
    target = os.path.abspath(os.path.join(root, relative))
    if os.path.commonpath([root, target]) != root: raise ValueError('Analysis path escapes project root.')
    return target
def dotted(node):
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute): return f'{dotted(node.value)}.{node.attr}'
    return ''

trees = {}
for relative in files:
    target = safe_file(relative)
    with open(target, encoding='utf-8') as handle: content = handle.read()
    tree = ast.parse(content, filename=relative, type_comments=True)
    trees[relative] = (tree, content)
    file_records.append({'file': relative, 'sha256': digest(content)})
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            identifier = f'{relative}#{node.name}'
            functions[identifier] = {'id': identifier, 'file': relative, 'start': node.lineno, 'end': node.end_lineno, 'parameters': [arg.arg for arg in node.args.args], 'sources': [], 'sinks': []}

for relative, (tree, content) in trees.items():
    imports = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module:
            module_file = f'{node.module.replace(".", os.sep)}.py'
            for name in node.names: imports[name.asname or name.name] = f'{module_file}#{name.name}'
    class Visitor(ast.NodeVisitor):
        def __init__(self): self.stack = []
        def visit_FunctionDef(self, node):
            self.stack.append(f'{relative}#{node.name}'); self.generic_visit(node); self.stack.pop()
        visit_AsyncFunctionDef = visit_FunctionDef
        def visit_Name(self, node):
            if self.stack and node.id in source_names: functions[self.stack[-1]]['sources'].append({'name': node.id, 'line': node.lineno})
        def visit_Call(self, node):
            name = dotted(node.func); short = name.split('.')[-1]; caller = self.stack[-1] if self.stack else None
            target = imports.get(short) or (f'{relative}#{short}' if f'{relative}#{short}' in functions else None)
            calls.append({'caller': caller, 'calleeText': name, 'target': target, 'file': relative, 'start': node.lineno, 'end': node.end_lineno})
            if caller and short in sink_names:
                functions[caller]['sinks'].append({'name': short, 'line': node.lineno})
                start = getattr(node, 'col_offset', 0); end = max(start + 1, getattr(node, 'end_col_offset', start + 1))
                findings.append({'schemaVersion': 1, 'projectId': project_id, 'language': 'django' if 'django' in relative.lower().split(os.sep) else 'python', 'kind': 'semantic-security-sink', 'file': relative, 'boundary': f'{relative}:{node.lineno}:{start}-{node.end_lineno}:{end}', 'start': start, 'end': end, 'baseSha256': digest(content), 'toolId': 'python-ast', 'toolVersion': platform.python_version(), 'callee': name, 'proofStageSatisfied': False, 'promotionAuthorized': False})
            self.generic_visit(node)
    Visitor().visit(tree)

paths = []
for identifier, entry in functions.items():
    if not entry['sources']: continue
    queue, seen = [[identifier]], {identifier}
    while queue:
        chain = queue.pop(0); last = chain[-1]
        if functions.get(last, {}).get('sinks'):
            paths.append({'functions': chain, 'source': entry['sources'][0], 'sink': functions[last]['sinks'][0]}); continue
        for call in calls:
            if call['caller'] == last and call['target'] in functions and call['target'] not in seen:
                seen.add(call['target']); queue.append(chain + [call['target']])

print(json.dumps({'schemaVersion': 1, 'projectId': project_id, 'adapter': {'id': 'python-ast', 'version': platform.python_version()}, 'files': file_records, 'diagnostics': [], 'functions': list(functions.values()), 'calls': calls, 'interproceduralPaths': paths, 'findings': findings}, separators=(',', ':')))

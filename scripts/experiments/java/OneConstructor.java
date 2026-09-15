// Negative control for the same claim, and it must FAIL the expected property.
//
// Identical in shape to ManyConstructors and different in exactly one variable: it declares one
// constructor. If a harness reports this as satisfying "more than one constructor", the harness
// is measuring nothing - which is the whole reason this file exists rather than being implied.
public class OneConstructor {
  private final String origin;

  OneConstructor() { this.origin = "no-arg"; }

  String origin() { return this.origin; }

  public static void main(String[] args) {
    System.out.println("CONSTRUCTED|" + new OneConstructor().origin());
    System.out.println("DECLARED|" + OneConstructor.class.getDeclaredConstructors().length);
  }
}

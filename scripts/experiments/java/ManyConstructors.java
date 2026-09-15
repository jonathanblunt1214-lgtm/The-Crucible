// Experiment fixture for the claim "Any class can have more than one constructor."
//
// It is deliberately self-measuring. Each constructor records where it came from, main invokes
// every one of them, and the class then reports the count the runtime itself sees through
// reflection. So the observation is the JVM's, not the harness author's: CONSTRUCTED lines prove
// each constructor is separately invocable, and DECLARED is the runtime's own tally.
public class ManyConstructors {
  private final String origin;

  ManyConstructors() { this.origin = "no-arg"; }

  ManyConstructors(int count) { this.origin = "int:" + count; }

  ManyConstructors(String label, int count) { this.origin = "string-int:" + label + ":" + count; }

  String origin() { return this.origin; }

  public static void main(String[] args) {
    System.out.println("CONSTRUCTED|" + new ManyConstructors().origin());
    System.out.println("CONSTRUCTED|" + new ManyConstructors(2).origin());
    System.out.println("CONSTRUCTED|" + new ManyConstructors("x", 3).origin());
    System.out.println("DECLARED|" + ManyConstructors.class.getDeclaredConstructors().length);
  }
}

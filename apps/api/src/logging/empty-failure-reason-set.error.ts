/** reasons が空集合で AppException を作ろうとした（fail-fast: 理由不明の失敗を許さない）。 */
class EmptyFailureReasonSetError extends Error {
  public constructor() {
    super("AppException は少なくとも1つの failure reason を持たなければならない");
    this.name = "EmptyFailureReasonSetError";
  }
}

export { EmptyFailureReasonSetError };

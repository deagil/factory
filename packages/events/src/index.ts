// Events (SYSTEM_DESIGN §4.7): the dispatcher, which starts the workflows an
// event or a schedule starts (P2.19). Events themselves are written by the
// pipeline and the runner, in the transaction of the change they record.
export { createDispatcher } from "./dispatcher.ts";
export type { Dispatcher, DispatcherOptions } from "./dispatcher.ts";

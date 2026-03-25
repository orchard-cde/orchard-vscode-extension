declare module 'eventsource' {
  interface EventSourceInit {
    headers?: Record<string, string>;
    https?: object;
    proxy?: string;
    withCredentials?: boolean;
  }

  class EventSource {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSED: 2;

    readonly readyState: number;
    readonly url: string;

    onopen: ((event: MessageEvent) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: MessageEvent) => void) | null;

    constructor(url: string, eventSourceInitDict?: EventSourceInit);

    addEventListener(
      type: string,
      listener: (event: MessageEvent) => void,
    ): void;
    removeEventListener(
      type: string,
      listener: (event: MessageEvent) => void,
    ): void;
    close(): void;
  }

  interface MessageEvent {
    data: string;
    lastEventId: string;
    origin: string;
    type: string;
  }

  export default EventSource;
}

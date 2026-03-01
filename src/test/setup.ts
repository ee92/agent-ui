class MemoryStorage {
  private store = new Map<string, string>();

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key) ?? null : null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

if (!globalThis.window) {
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true
  });
}

if (!globalThis.location) {
  Object.defineProperty(globalThis, "location", {
    value: {
      host: "127.0.0.1:18789",
      protocol: "http:"
    },
    configurable: true
  });
}

if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true
  });
}

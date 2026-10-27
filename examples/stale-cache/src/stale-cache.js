export class ValueCache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    if (!this.store.has(key)) this.store.set(key, value);
  }
}

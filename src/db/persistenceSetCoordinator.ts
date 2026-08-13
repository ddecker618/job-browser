export class PersistenceSetCoordinator {
  private activeReaders = 0;
  private writerActive = false;
  private readonly readersWaiting: (() => void)[] = [];
  private readonly writersWaiting: (() => void)[] = [];

  public async withRead<T>(operation: () => T | Promise<T>): Promise<T> {
    await this.acquireRead();
    try {
      return await operation();
    } finally {
      this.releaseRead();
    }
  }

  public async withWrite<T>(operation: () => T | Promise<T>): Promise<T> {
    await this.acquireWrite();
    try {
      return await operation();
    } finally {
      this.releaseWrite();
    }
  }

  private acquireRead(): Promise<void> {
    if (!this.writerActive) {
      this.activeReaders += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.readersWaiting.push(resolve));
  }

  private acquireWrite(): Promise<void> {
    if (!this.writerActive && this.activeReaders === 0) {
      this.writerActive = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.writersWaiting.push(resolve));
  }

  private releaseRead(): void {
    this.activeReaders -= 1;
    if (this.activeReaders === 0 && this.writersWaiting.length > 0) {
      this.promoteWriter(this.writersWaiting.shift());
    }
  }

  private releaseWrite(): void {
    this.writerActive = false;
    if (this.readersWaiting.length > 0) {
      const readers = this.readersWaiting.splice(0);
      this.activeReaders += readers.length;
      for (const resolve of readers) resolve();
      return;
    }
    if (this.writersWaiting.length > 0) {
      this.promoteWriter(this.writersWaiting.shift());
    }
  }

  private promoteWriter(resolve: (() => void) | undefined): void {
    if (resolve === undefined) return;
    this.writerActive = true;
    resolve();
  }
}

export const persistenceSetCoordinator = new PersistenceSetCoordinator();

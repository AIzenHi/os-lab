// 文件系统:磁盘块分配与 inode(4 个直接块,教学简化)
export const DISK_BLOCKS = 128;

export interface Inode {
  id: number;
  name: string;
  blocks: number[];
  kind: 'system' | 'proc' | 'checkpoint';
}

export class FileSystem {
  used: boolean[] = new Array(DISK_BLOCKS).fill(false);
  inodes: Inode[] = [];
  nextInodeId = 1;
  reads = 0;
  writes = 0;

  alloc(name: string, n: number, kind: Inode['kind']): Inode | null {
    const blocks: number[] = [];
    for (let i = 0; i < DISK_BLOCKS && blocks.length < n; i++) {
      if (!this.used[i]) {
        this.used[i] = true;
        blocks.push(i);
      }
    }
    if (blocks.length < n) {
      for (const b of blocks) this.used[b] = false;
      return null;
    }
    const inode: Inode = { id: this.nextInodeId++, name, blocks, kind };
    this.inodes.push(inode);
    return inode;
  }

  free(inode: Inode): void {
    for (const b of inode.blocks) this.used[b] = false;
    this.inodes = this.inodes.filter((i) => i !== inode);
  }

  byName(name: string): Inode | undefined {
    return this.inodes.find((i) => i.name === name);
  }

  usedCount(): number {
    return this.used.reduce((n, u) => n + (u ? 1 : 0), 0);
  }

  reset(): void {
    this.used.fill(false);
    this.inodes = [];
    this.nextInodeId = 1;
    this.reads = 0;
    this.writes = 0;
  }
}

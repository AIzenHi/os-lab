// 精简指令集与确定性程序生成器(教学简化:固定 8 寄存器,PC 为指令序号)
import type { ProcRole } from './types';
import { rngInt, type RNG } from './rng';

export const PAGE_SIZE = 256; // 虚拟页 256B
export const LINE_SIZE = 32; // 缓存行 32B
export const CODE_PAGE = 0; // 第 0 页为代码页
export const DATA_BASE_PAGE = 1; // 数据页从第 1 页开始
export const REG_COUNT = 8; // R0 恒为 0

export type SysName =
  | 'write'
  | 'read'
  | 'sleep'
  | 'yield'
  | 'exit'
  | 'p0'
  | 'p1'
  | 'v0'
  | 'v1';

export type Op =
  | 'nop'
  | 'li'
  | 'add'
  | 'addi'
  | 'sub'
  | 'mul'
  | 'div'
  | 'lw'
  | 'sw'
  | 'beq'
  | 'bne'
  | 'jmp'
  | 'sys';

export interface Instr {
  op: Op;
  rd?: number; // 目的寄存器(LW)或源值寄存器(SW)
  rs?: number; // 源寄存器 1 / 基址寄存器(LW)
  rt?: number; // 源寄存器 2 / 基址寄存器(SW)
  imm?: number; // 立即数 / 有效地址偏移
  target?: number; // 跳转目标(指令序号)
  sys?: SysName;
}

export interface Program {
  instrs: Instr[];
  wsPages: number[]; // 数据工作集虚拟页号
  estimate: number; // 预计动态指令数
  syscalls: SysName[];
}

const sweepBody = (rng: RNG): Instr[] => [
  { op: 'lw', rd: 3, rs: 1, imm: 0 },
  { op: 'add', rd: 4, rs: 3, rt: 1 },
  { op: 'sw', rd: 4, rt: 1, imm: 32 + rngInt(rng, 0, 3) * 32 },
  { op: 'lw', rd: 5, rs: 1, imm: 64 },
  { op: 'mul', rd: 4, rs: 4, rt: 5 },
  { op: 'addi', rd: 1, rs: 1, imm: 32 },
  { op: 'sub', rd: 6, rs: 1, rt: 2 },
];

/** 生成扫描工作集的循环体:指针 R1 每轮 +32,扫到 R2(终点)后重置并圈数减一
 *  终点留出一页余量,保证 +128 偏移的访存不越出映射区间 */
function buildSweep(out: Instr[], rng: RNG, pages: number, sweeps: number): number {
  const base = DATA_BASE_PAGE * PAGE_SIZE;
  const sweepPages = Math.max(1, pages - 1);
  const end = base + sweepPages * PAGE_SIZE;
  const perSweep = (sweepPages * PAGE_SIZE) / 32;
  out.push({ op: 'li', rd: 1, imm: base });
  out.push({ op: 'li', rd: 2, imm: end });
  out.push({ op: 'li', rd: 7, imm: sweeps });
  const loopStart = out.length;
  out.push(...sweepBody(rng));
  // R1 != end → 跳过"一圈结束"处理
  out.push({ op: 'bne', rs: 6, rt: 0, target: 0 });
  const bneReset = out.length - 1;
  out.push({ op: 'li', rd: 1, imm: base }); // 重置扫描指针
  out.push({ op: 'addi', rd: 7, rs: 7, imm: -1 }); // 圈数减一(仅一圈结束时)
  const skipReset = out.length;
  out[bneReset] = { op: 'bne', rs: 6, rt: 0, target: skipReset };
  out.push({ op: 'bne', rs: 7, rt: 0, target: loopStart });
  return sweeps * perSweep;
}

export function buildProgram(role: ProcRole, rng: RNG): Program {
  const out: Instr[] = [];
  const syscalls: SysName[] = [];
  let estimate = 8;
  let wsCount = 6;

  const addSweep = (pages: number, sweeps: number) => {
    estimate += buildSweep(out, rng, pages, sweeps) * 10 + 12;
  };

  switch (role) {
    case 'compute':
      wsCount = 6;
      addSweep(6, 2);
      break;
    case 'io':
      wsCount = 4;
      addSweep(4, 1);
      out.push({ op: 'sys', sys: 'write' });
      syscalls.push('write');
      out.push({ op: 'sys', sys: 'sleep' });
      syscalls.push('sleep');
      addSweep(4, 1);
      out.push({ op: 'sys', sys: 'write' });
      syscalls.push('write');
      estimate += 120;
      break;
    case 'mixed':
      wsCount = 6;
      addSweep(6, 1);
      out.push({ op: 'sys', sys: 'write' });
      syscalls.push('write');
      addSweep(6, 1);
      out.push({ op: 'sys', sys: 'read' });
      syscalls.push('read');
      estimate += 120;
      break;
    case 'deadA':
      wsCount = 2;
      out.push({ op: 'sys', sys: 'p0' });
      syscalls.push('p0');
      // 40 条运算垫在两次 P 之间,保证 RR 交错时形成循环等待
      for (let i = 0; i < 40; i++) out.push({ op: 'addi', rd: 3, rs: 3, imm: 1 });
      out.push({ op: 'sys', sys: 'p1' });
      syscalls.push('p1');
      out.push({ op: 'sys', sys: 'v1' });
      syscalls.push('v1');
      out.push({ op: 'sys', sys: 'v0' });
      syscalls.push('v0');
      estimate = 96;
      break;
    case 'deadB':
      wsCount = 2;
      out.push({ op: 'sys', sys: 'p1' });
      syscalls.push('p1');
      for (let i = 0; i < 40; i++) out.push({ op: 'addi', rd: 3, rs: 3, imm: 1 });
      out.push({ op: 'sys', sys: 'p0' });
      syscalls.push('p0');
      out.push({ op: 'sys', sys: 'v0' });
      syscalls.push('v0');
      out.push({ op: 'sys', sys: 'v1' });
      syscalls.push('v1');
      estimate = 96;
      break;
    case 'starveLow':
      wsCount = 8;
      addSweep(8, 8);
      break;
    case 'daemon':
      wsCount = 6;
      // 周期性让出 CPU:与同类守护进程交替运行,持续占据处理器
      for (let r = 0; r < 3; r++) {
        addSweep(6, 1);
        out.push({ op: 'sys', sys: 'yield' });
        syscalls.push('yield');
      }
      break;
    case 'thrash':
      // 跨页大步进扫描:每次迭代进入新页,几乎没有页内复用 → 制造缺页风暴
      wsCount = 8;
      out.push({ op: 'li', rd: 1, imm: DATA_BASE_PAGE * PAGE_SIZE });
      out.push({ op: 'li', rd: 2, imm: (DATA_BASE_PAGE + 8) * PAGE_SIZE });
      out.push({ op: 'li', rd: 7, imm: 12 });
      {
        const loopStart = out.length;
        out.push({ op: 'lw', rd: 3, rs: 1, imm: 0 });
        out.push({ op: 'add', rd: 4, rs: 3, rt: 3 });
        out.push({ op: 'sw', rd: 4, rt: 1, imm: 64 });
        out.push({ op: 'lw', rd: 5, rs: 1, imm: 128 });
        out.push({ op: 'mul', rd: 4, rs: 4, rt: 5 });
        out.push({ op: 'addi', rd: 1, rs: 1, imm: PAGE_SIZE });
        out.push({ op: 'sub', rd: 6, rs: 1, rt: 2 });
        out.push({ op: 'bne', rs: 6, rt: 0, target: 0 });
        const bneReset = out.length - 1;
        out.push({ op: 'li', rd: 1, imm: DATA_BASE_PAGE * PAGE_SIZE });
        out.push({ op: 'addi', rd: 7, rs: 7, imm: -1 });
        const skipReset = out.length;
        out[bneReset] = { op: 'bne', rs: 6, rt: 0, target: skipReset };
        out.push({ op: 'bne', rs: 7, rt: 0, target: loopStart });
      }
      estimate = 12 * 8 * 10 + 12;
      break;
  }

  out.push({ op: 'sys', sys: 'exit' });
  syscalls.push('exit');

  const wsPages: number[] = [];
  for (let i = 0; i < wsCount; i++) wsPages.push(DATA_BASE_PAGE + i);

  return { instrs: out, wsPages, estimate: Math.round(estimate), syscalls };
}

export function instrText(i: Instr): string {
  switch (i.op) {
    case 'li':
      return `LI R${i.rd}, ${i.imm}`;
    case 'add':
      return `ADD R${i.rd}, R${i.rs}, R${i.rt}`;
    case 'addi':
      return `ADDI R${i.rd}, R${i.rs}, ${i.imm}`;
    case 'sub':
      return `SUB R${i.rd}, R${i.rs}, R${i.rt}`;
    case 'mul':
      return `MUL R${i.rd}, R${i.rs}, R${i.rt}`;
    case 'div':
      return `DIV R${i.rd}, R${i.rs}, R${i.rt}`;
    case 'lw':
      return `LW R${i.rd}, [R${i.rs}+${i.imm}]`;
    case 'sw':
      return `SW R${i.rd}, [R${i.rt}+${i.imm}]`;
    case 'beq':
      return `BEQ R${i.rs}, R${i.rt}, ${i.target}`;
    case 'bne':
      return `BNE R${i.rs}, R${i.rt}, ${i.target}`;
    case 'jmp':
      return `JMP ${i.target}`;
    case 'sys':
      return `SYS ${i.sys?.toUpperCase()}`;
    default:
      return 'NOP';
  }
}

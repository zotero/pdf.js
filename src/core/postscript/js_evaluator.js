/* Copyright 2026 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  parsePostScriptFunction,
  PS_NODE,
  PS_VALUE_TYPE,
  PSStackToTree,
} from "./ast.js";
import { MathClamp } from "../../shared/util.js";
import { TOKEN } from "./lexer.js";

// Consecutive integers for a dense jump table in _execute.
// 2-slot: ARG, CONST, IF, JUMP, SHIFT. 4-slot: STORE. All others: 1 slot.
const OP = {
  ARG: 0, // [ARG, idx]
  CONST: 1, // [CONST, val]
  STORE: 2, // [STORE, slot, min, max]  clamp(pop()) → mem[slot]
  IF: 3, // [IF, target]  jump when top-of-stack === 0
  JUMP: 4, // [JUMP, target]  unconditional
  ABS: 5,
  NEG: 6,
  CEIL: 7,
  FLOOR: 8,
  ROUND: 9, // floor(x + 0.5)
  TRUNC: 10,
  NOT_B: 11, // boolean NOT
  NOT_N: 12, // bitwise NOT
  SQRT: 13,
  SIN: 14, // degrees in/out
  COS: 15,
  LN: 16,
  LOG10: 17,
  CVI: 18,
  SHIFT: 19, // [SHIFT, amount]  +ve = left, −ve = right
  // Binary ops: second below, first on top; result = second OP first.
  ADD: 20,
  SUB: 21,
  MUL: 22,
  DIV: 23, // 0 when divisor is 0
  IDIV: 24, // 0 when divisor is 0
  MOD: 25, // 0 when divisor is 0
  POW: 26,
  EQ: 27,
  NE: 28,
  GT: 29,
  GE: 30,
  LT: 31,
  LE: 32,
  AND: 33,
  OR: 34,
  XOR: 35,
  ATAN: 36, // atan2(second, first) → degrees [0, 360)
  MIN: 37,
  MAX: 38,
  TEE_TMP: 39, // [TEE_TMP, slot]  peek top of stack → tmp[slot], leave on stack
  LOAD_TMP: 40, // [LOAD_TMP, slot]  push tmp[slot]
};

const _DEG_TO_RAD = Math.PI / 180;
const _RAD_TO_DEG = 180 / Math.PI;

class PsJsCompiler {
  // Safe because JS is single-threaded.
  static #stack = new Float64Array(64);

  static #tmp = new Float64Array(64);

  constructor(domain, range) {
    this.nIn = domain.length >> 1;
    this.nOut = range.length >> 1;
    this.range = range;
    this.ir = [];
    this._tmpMap = new Map(); // node → tmp slot index (CSE)
    this._nextTmp = 0;
  }

  _compileNode(node) {
    if (node.shared) {
      const cached = this._tmpMap.get(node);
      if (cached !== undefined) {
        this.ir.push(OP.LOAD_TMP, cached);
        return true;
      }
      if (!this._compileNodeImpl(node)) {
        return false;
      }
      const slot = this._nextTmp++;
      this._tmpMap.set(node, slot);
      this.ir.push(OP.TEE_TMP, slot);
      return true;
    }
    return this._compileNodeImpl(node);
  }

  _compileNodeImpl(node) {
    switch (node.type) {
      case PS_NODE.arg:
        this.ir.push(OP.ARG, node.index);
        return true;

      case PS_NODE.const: {
        const v = node.value;
        this.ir.push(OP.CONST, typeof v === "boolean" ? Number(v) : v);
        return true;
      }

      case PS_NODE.unary:
        return this._compileUnary(node);

      case PS_NODE.binary:
        return this._compileBinary(node);

      case PS_NODE.ternary:
        return this._compileTernary(node);

      default:
        return false;
    }
  }

  _compileUnary(node) {
    const { op, operand, valueType } = node;

    // cvr is a no-op — values are already f64.
    if (op === TOKEN.cvr) {
      return this._compileNode(operand);
    }

    if (!this._compileNode(operand)) {
      return false;
    }

    switch (op) {
      case TOKEN.abs:
        this.ir.push(OP.ABS);
        break;
      case TOKEN.neg:
        this.ir.push(OP.NEG);
        break;
      case TOKEN.ceiling:
        this.ir.push(OP.CEIL);
        break;
      case TOKEN.floor:
        this.ir.push(OP.FLOOR);
        break;
      case TOKEN.round:
        this.ir.push(OP.ROUND);
        break;
      case TOKEN.truncate:
        this.ir.push(OP.TRUNC);
        break;
      case TOKEN.sqrt:
        this.ir.push(OP.SQRT);
        break;
      case TOKEN.sin:
        this.ir.push(OP.SIN);
        break;
      case TOKEN.cos:
        this.ir.push(OP.COS);
        break;
      case TOKEN.ln:
        this.ir.push(OP.LN);
        break;
      case TOKEN.log:
        this.ir.push(OP.LOG10);
        break;
      case TOKEN.cvi:
        this.ir.push(OP.CVI);
        break;
      case TOKEN.not:
        if (valueType === PS_VALUE_TYPE.boolean) {
          this.ir.push(OP.NOT_B);
        } else if (valueType === PS_VALUE_TYPE.numeric) {
          this.ir.push(OP.NOT_N);
        } else {
          return false;
        }
        break;
      default:
        return false;
    }
    return true;
  }

  _compileBinary(node) {
    const { op, first, second } = node;

    // bitshift requires a constant shift amount.
    if (op === TOKEN.bitshift) {
      if (first.type !== PS_NODE.const || !Number.isInteger(first.value)) {
        return false;
      }
      if (!this._compileNode(second)) {
        return false;
      }
      this.ir.push(OP.SHIFT, first.value);
      return true;
    }

    if (!this._compileNode(second)) {
      return false;
    }
    if (!this._compileNode(first)) {
      return false;
    }

    switch (op) {
      case TOKEN.add:
        this.ir.push(OP.ADD);
        break;
      case TOKEN.sub:
        this.ir.push(OP.SUB);
        break;
      case TOKEN.mul:
        this.ir.push(OP.MUL);
        break;
      case TOKEN.div:
        this.ir.push(OP.DIV);
        break;
      case TOKEN.idiv:
        this.ir.push(OP.IDIV);
        break;
      case TOKEN.mod:
        this.ir.push(OP.MOD);
        break;
      case TOKEN.exp:
        this.ir.push(OP.POW);
        break;
      case TOKEN.eq:
        this.ir.push(OP.EQ);
        break;
      case TOKEN.ne:
        this.ir.push(OP.NE);
        break;
      case TOKEN.gt:
        this.ir.push(OP.GT);
        break;
      case TOKEN.ge:
        this.ir.push(OP.GE);
        break;
      case TOKEN.lt:
        this.ir.push(OP.LT);
        break;
      case TOKEN.le:
        this.ir.push(OP.LE);
        break;
      case TOKEN.and:
        this.ir.push(OP.AND);
        break;
      case TOKEN.or:
        this.ir.push(OP.OR);
        break;
      case TOKEN.xor:
        this.ir.push(OP.XOR);
        break;
      case TOKEN.atan:
        this.ir.push(OP.ATAN);
        break;
      case TOKEN.min:
        this.ir.push(OP.MIN);
        break;
      case TOKEN.max:
        this.ir.push(OP.MAX);
        break;
      default:
        return false;
    }
    return true;
  }

  _compileTernary(node) {
    if (!this._compileNode(node.cond)) {
      return false;
    }

    this.ir.push(OP.IF, 0);
    const ifPatch = this.ir.length - 1;

    if (!this._compileNode(node.then)) {
      return false;
    }

    this.ir.push(OP.JUMP, 0);
    const jumpPatch = this.ir.length - 1;

    this.ir[ifPatch] = this.ir.length; // IF jumps here on false
    if (!this._compileNode(node.otherwise)) {
      return false;
    }

    this.ir[jumpPatch] = this.ir.length; // JUMP lands here
    return true;
  }

  compile(program) {
    const outputs = new PSStackToTree().evaluate(program, this.nIn);
    if (!outputs || outputs.length < this.nOut) {
      return null;
    }

    for (let i = 0; i < this.nOut; i++) {
      if (!this._compileNode(outputs[i])) {
        return null;
      }
      const min = this.range[i * 2];
      const max = this.range[i * 2 + 1];
      this.ir.push(OP.STORE, i, min, max);
    }

    return new Float64Array(this.ir);
  }

  static execute(ir, src, srcOffset, dest, destOffset) {
    let ip = 0,
      sp = 0;
    const n = ir.length;
    const stack = PsJsCompiler.#stack;
    const tmp = PsJsCompiler.#tmp;

    while (ip < n) {
      switch (ir[ip++] | 0) {
        case OP.ARG:
          stack[sp++] = src[srcOffset + (ir[ip++] | 0)];
          break;
        case OP.CONST:
          stack[sp++] = ir[ip++];
          break;
        case OP.STORE: {
          const slot = ir[ip++] | 0;
          const min = ir[ip++];
          const max = ir[ip++];
          dest[destOffset + slot] = MathClamp(stack[--sp], min, max);
          break;
        }
        case OP.IF: {
          const tgt = ir[ip++];
          if (stack[--sp] === 0) {
            ip = tgt;
          }
          break;
        }
        case OP.JUMP:
          ip = ir[ip];
          break;
        case OP.ABS:
          stack[sp - 1] = Math.abs(stack[sp - 1]);
          break;
        case OP.NEG:
          stack[sp - 1] = -stack[sp - 1];
          break;
        case OP.CEIL:
          stack[sp - 1] = Math.ceil(stack[sp - 1]);
          break;
        case OP.FLOOR:
          stack[sp - 1] = Math.floor(stack[sp - 1]);
          break;
        case OP.ROUND:
          stack[sp - 1] = Math.floor(stack[sp - 1] + 0.5);
          break;
        case OP.TRUNC:
          stack[sp - 1] = Math.trunc(stack[sp - 1]);
          break;
        case OP.NOT_B:
          stack[sp - 1] = stack[sp - 1] !== 0 ? 0 : 1;
          break;
        case OP.NOT_N:
          stack[sp - 1] = ~(stack[sp - 1] | 0);
          break;
        case OP.SQRT:
          stack[sp - 1] = Math.sqrt(stack[sp - 1]);
          break;
        case OP.SIN:
          stack[sp - 1] = Math.sin((stack[sp - 1] % 360) * _DEG_TO_RAD);
          break;
        case OP.COS:
          stack[sp - 1] = Math.cos((stack[sp - 1] % 360) * _DEG_TO_RAD);
          break;
        case OP.LN:
          stack[sp - 1] = Math.log(stack[sp - 1]);
          break;
        case OP.LOG10:
          stack[sp - 1] = Math.log10(stack[sp - 1]);
          break;
        case OP.CVI:
          stack[sp - 1] = Math.trunc(stack[sp - 1]) | 0;
          break;
        case OP.SHIFT: {
          const amt = ir[ip++];
          const v = stack[sp - 1] | 0;
          if (amt > 0) {
            stack[sp - 1] = v << amt;
          } else if (amt < 0) {
            stack[sp - 1] = v >> -amt;
          } else {
            stack[sp - 1] = v;
          }
          break;
        }
        case OP.ADD: {
          const b = stack[--sp];
          stack[sp - 1] += b;
          break;
        }
        case OP.SUB: {
          const b = stack[--sp];
          stack[sp - 1] -= b;
          break;
        }
        case OP.MUL: {
          const b = stack[--sp];
          stack[sp - 1] *= b;
          break;
        }
        case OP.DIV: {
          const b = stack[--sp];
          stack[sp - 1] = b !== 0 ? stack[sp - 1] / b : 0;
          break;
        }
        case OP.IDIV: {
          const b = stack[--sp];
          stack[sp - 1] = b !== 0 ? Math.trunc(stack[sp - 1] / b) : 0;
          break;
        }
        case OP.MOD: {
          const b = stack[--sp];
          stack[sp - 1] = b !== 0 ? stack[sp - 1] % b : 0;
          break;
        }
        case OP.POW: {
          const b = stack[--sp];
          stack[sp - 1] **= b;
          break;
        }
        case OP.EQ: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] === b ? 1 : 0;
          break;
        }
        case OP.NE: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] !== b ? 1 : 0;
          break;
        }
        case OP.GT: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] > b ? 1 : 0;
          break;
        }
        case OP.GE: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] >= b ? 1 : 0;
          break;
        }
        case OP.LT: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] < b ? 1 : 0;
          break;
        }
        case OP.LE: {
          const b = stack[--sp];
          stack[sp - 1] = stack[sp - 1] <= b ? 1 : 0;
          break;
        }
        case OP.AND: {
          const b = stack[--sp] | 0;
          stack[sp - 1] = (stack[sp - 1] | 0) & b;
          break;
        }
        case OP.OR: {
          const b = stack[--sp] | 0;
          stack[sp - 1] = stack[sp - 1] | 0 | b;
          break;
        }
        case OP.XOR: {
          const b = stack[--sp] | 0;
          stack[sp - 1] = (stack[sp - 1] | 0) ^ b;
          break;
        }
        case OP.ATAN: {
          const b = stack[--sp];
          const deg = Math.atan2(stack[sp - 1], b) * _RAD_TO_DEG;
          stack[sp - 1] = deg < 0 ? deg + 360 : deg;
          break;
        }
        case OP.MIN: {
          const b = stack[--sp];
          stack[sp - 1] = Math.min(stack[sp - 1], b);
          break;
        }
        case OP.MAX: {
          const b = stack[--sp];
          stack[sp - 1] = Math.max(stack[sp - 1], b);
          break;
        }
        case OP.TEE_TMP:
          tmp[ir[ip++] | 0] = stack[sp - 1];
          break;
        case OP.LOAD_TMP:
          stack[sp++] = tmp[ir[ip++] | 0];
          break;
      }
    }
  }
}

/**
 * @param {string}   source
 * @param {number[]} domain  – flat [min0,max0, …]
 * @param {number[]} range   – flat [min0,max0, …]
 * @returns {Float64Array|null}
 */
function compilePostScriptToIR(source, domain, range) {
  return new PsJsCompiler(domain, range).compile(
    parsePostScriptFunction(source)
  );
}

/**
 * Same calling convention as the Wasm wrapper:
 *   fn(src, srcOffset, dest, destOffset)
 *
 * @param {string}   source
 * @param {number[]} domain  – flat [min0,max0, …]
 * @param {number[]} range   – flat [min0,max0, …]
 * @returns {Function|null}
 */
function buildPostScriptJsFunction(source, domain, range) {
  const ir = compilePostScriptToIR(source, domain, range);
  if (!ir) {
    return null;
  }

  return (src, srcOffset, dest, destOffset) => {
    PsJsCompiler.execute(ir, src, srcOffset, dest, destOffset);
  };
}

export { buildPostScriptJsFunction, compilePostScriptToIR };

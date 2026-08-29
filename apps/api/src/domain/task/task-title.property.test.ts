import { describe, expect, it, vi } from "vitest";

import { TaskTitle } from "./task-title.js";
import { TaskTitleEmptyError } from "./task-title-empty.error.js";
import { TaskTitleTooLongError } from "./task-title-too-long.error.js";

vi.setConfig({ testTimeout: 5000 });

/**
 * Property-based テスト（§4「domain のテストは table-driven + property-based を1本」）。
 *
 * 報告事項: pnpm-workspace.yaml の catalog に property-based testing 用のライブラリ
 * （fast-check 等）が pin されておらず、spec もライブラリ名を指定していない。
 * 未 pin の依存を推測で追加しない方針（absolute-rules）に従い、外部ライブラリを
 * 追加せず、固定シードの手組み PRNG で入力を生成する形で代替している。
 * ライブラリを catalog に追加する判断をした場合はこのファイルを差し替えること。
 */

// 2^32。>>> 0 の代わりに % で 32bit 相当の周期を作る（no-bitwise 対応）。
const PRNG_MODULUS = 4_294_967_296;
// 線形合同法（LCG）の乗数・増分。
const LCG_MULTIPLIER = 1_664_525;
const LCG_INCREMENT = 1_013_904_223;

const createPseudoRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % PRNG_MODULUS;
    return state / PRNG_MODULUS;
  };
};

const randomFiller = (random: () => number, length: number): string => {
  const characters = "あいうえおかきくけこABCDEFGHIJ 　";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    const charIndex = Math.floor(random() * characters.length);
    result += characters.charAt(charIndex);
  }
  return result;
};

/**
 * 先頭・末尾を必ず非空白文字（"x"）にすることで trim() が長さを変えないことを保証する。
 * これにより生成した length と TaskTitle.create 後の value.length を一致させられる。
 */
const randomTitleCandidate = (random: () => number, length: number): string => {
  if (length <= 1) {
    return "x";
  }
  return `x${randomFiller(random, length - 2)}x`;
};

const RANDOM_SEED = 20_260_808;
const MAX_EXTRA_WHITESPACE_LENGTH = 20;
const MAX_EXTRA_LENGTH_OVER_MAX = 100;

describe("taskTitle.create の不変条件（property-based）", () => {
  const random = createPseudoRandom(RANDOM_SEED);
  const iterationCount = 200;

  it("trim後 1〜120 文字の任意の文字列は成功し、value は trim 済みの文字列と一致する", () => {
    expect.hasAssertions();
    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      const length = 1 + Math.floor(random() * TaskTitle.maxLength);
      const rawValue = randomTitleCandidate(random, length);

      const title = TaskTitle.create(rawValue);

      expect(title.value).toBe(rawValue.trim());
      expect(title.value).toHaveLength(length);
    }
  });

  it("trim後に空になる任意の空白文字列は TaskTitleEmptyError を throw する", () => {
    expect.hasAssertions();
    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      const whitespaceLength = Math.floor(random() * MAX_EXTRA_WHITESPACE_LENGTH);
      const rawValue = " \t　".repeat(1) + " ".repeat(whitespaceLength);

      expect(() => TaskTitle.create(rawValue)).toThrow(TaskTitleEmptyError);
    }
  });

  it("trim後 121 文字以上になる任意の文字列は TaskTitleTooLongError を throw する", () => {
    expect.hasAssertions();
    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      const length = TaskTitle.maxLength + 1 + Math.floor(random() * MAX_EXTRA_LENGTH_OVER_MAX);
      const rawValue = randomTitleCandidate(random, length);

      expect(() => TaskTitle.create(rawValue)).toThrow(TaskTitleTooLongError);
    }
  });
});

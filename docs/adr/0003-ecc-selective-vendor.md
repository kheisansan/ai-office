# ADR 0003: ECC は選択ベンダー

- Status: Accepted
- Date: 2026-11-16

## Decision

`install --profile minimal` でも rules-core 全体などが入りコンテキストが膨らむため、
本リポジトリでは `vendor/ecc/rules/{common,typescript}` と指定スキルだけをコピーする。

ソース: `~/repository/ECC`。

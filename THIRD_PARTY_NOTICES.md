# Third-party dependency declarations

更新：2026-11-08。适用版本：`1.0.0-rc.2`（`1.0.0-rc` 线准备中）。

Upstream code: AskTheWay/dsh-auto-memory v1.3.0, MIT. Original notice is preserved in LICENSE.

This is the fixed lockfile declaration inventory, including optional platform dependencies; it is not a completed license-text or vulnerability audit. Individual upstream notices and obligations must be checked before public distribution. No personal data is covered by these software licenses.

## 本插件直接运行时依赖（由包管理器安装，不打包进 tarball）

| Resolved package | Version | Declared license | LICENSE SHA-256 |
|---|---|---|---|
| @deepseek-ai/cosmokit | 1.8.6 | MIT | `034FB52B1D57360ECBAE6CB1632A88F86FD7C3D3F5631A5F082710203DDA0BE7` |
| @deepseek-ai/schemastery | 3.18.5 | MIT | `034FB52B1D57360ECBAE6CB1632A88F86FD7C3D3F5631A5F082710203DDA0BE7` |
| @standard-schema/spec | 1.1.0 | MIT | `653B779005A3A4D64A7288C940F7B9A0E8F0B1E0375F6AA6AF9473CAF131E564` |
| yaml | 2.9.1 | ISC | `5BBA27375D93E9119F76C1015F7672CF9AD5F70952296E0842FB2243D6376869` |

DSH peer packages are supplied by the host and are not included in this runtime resolution. Their distribution obligations and any changed resolution must be rechecked for the final target package and environment.

## Lockfile 清单（160 条）

| Lock entry | Version | Declared license |
|---|---|---|
| node_modules/@deepseek-ai/cordis | 4.0.2 | MIT |
| node_modules/@deepseek-ai/cosmokit | 1.8.3 | MIT |
| node_modules/@deepseek-ai/dsh-agent | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-atomic-write | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-brand | 0.1.5-rc.3 | MIT |
| node_modules/@deepseek-ai/dsh-client-connection | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-locale | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-store | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-ui-layout | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-ui-primitives | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-ui-renderer | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-ui-sidebar | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-client-ui-slots | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-code-runtime | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-credentials | 0.1.5-rc.3 | MIT |
| node_modules/@deepseek-ai/dsh-home-paths | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-invariants | 0.1.5-rc.3 | MIT |
| node_modules/@deepseek-ai/dsh-llm | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-scope | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-session | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-session-projection | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-system-prompt | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-timeout | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-tools | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-typert-protocol | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-user-approval | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-util-crypto | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/dsh-util-values | 0.1.5-rc.2 | MIT |
| node_modules/@deepseek-ai/schemastery | 3.18.2 | MIT |
| node_modules/@jridgewell/sourcemap-codec | 1.6.0 | MIT |
| node_modules/@oxc-project/types | 0.150.0 | MIT |
| node_modules/@quansync/fs | 1.1.0 | MIT |
| node_modules/@rolldown/binding-android-arm-eabi | 1.2.9 | MIT |
| node_modules/@rolldown/binding-android-arm64 | 1.2.9 | MIT |
| node_modules/@rolldown/binding-darwin-arm64 | 1.2.9 | MIT |
| node_modules/@rolldown/binding-darwin-x64 | 1.2.9 | MIT |
| node_modules/@rolldown/binding-freebsd-x64 | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-arm-gnueabihf | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-arm64-gnu | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-arm64-musl | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-ppc64-gnu | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-s390x-gnu | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-x64-gnu | 1.2.9 | MIT |
| node_modules/@rolldown/binding-linux-x64-musl | 1.2.9 | MIT |
| node_modules/@rolldown/binding-openharmony-arm64 | 1.2.9 | MIT |
| node_modules/@rolldown/binding-win32-arm64-msvc | 1.2.9 | MIT |
| node_modules/@rolldown/binding-win32-x64-msvc | 1.2.9 | MIT |
| node_modules/@rolldown/pluginutils | 1.0.1 | MIT |
| node_modules/@standard-schema/spec | 1.1.0 | MIT |
| node_modules/@types/chai | 5.2.3 | MIT |
| node_modules/@types/deep-eql | 4.0.2 | MIT |
| node_modules/@types/estree | 1.0.9 | MIT |
| node_modules/@types/node | 24.13.6 | MIT |
| node_modules/@types/react | 19.3.0 | MIT |
| node_modules/@types/react-dom | 19.3.0 | MIT |
| node_modules/@types/whatwg-mimetype | 3.0.2 | MIT |
| node_modules/@types/ws | 8.18.2 | MIT |
| node_modules/@vitest/expect | 4.1.11 | MIT |
| node_modules/@vitest/mocker | 4.1.11 | MIT |
| node_modules/@vitest/pretty-format | 4.1.11 | MIT |
| node_modules/@vitest/runner | 4.1.11 | MIT |
| node_modules/@vitest/snapshot | 4.1.11 | MIT |
| node_modules/@vitest/spy | 4.1.11 | MIT |
| node_modules/@vitest/utils | 4.1.11 | MIT |
| node_modules/@yuku-codegen/binding-android-arm64 | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-darwin-arm64 | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-darwin-x64 | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-freebsd-x64 | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-linux-arm-gnu | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-linux-arm-musl | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-linux-arm64-gnu | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-linux-arm64-musl | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-linux-x64-gnu | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-linux-x64-musl | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-win32-arm64 | 0.8.7 | MIT |
| node_modules/@yuku-codegen/binding-win32-x64 | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-android-arm64 | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-darwin-arm64 | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-darwin-x64 | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-freebsd-x64 | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-linux-arm-gnu | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-linux-arm-musl | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-linux-arm64-gnu | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-linux-arm64-musl | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-linux-x64-gnu | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-linux-x64-musl | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-win32-arm64 | 0.8.7 | MIT |
| node_modules/@yuku-parser/binding-win32-x64 | 0.8.7 | MIT |
| node_modules/@yuku-toolchain/types | 0.8.7 | MIT |
| node_modules/ansis | 4.4.0 | ISC |
| node_modules/assertion-error | 2.0.1 | MIT |
| node_modules/buffer-image-size | 0.6.4 | MIT |
| node_modules/cac | 7.0.0 | MIT |
| node_modules/chai | 6.2.2 | MIT |
| node_modules/convert-source-map | 2.0.0 | MIT |
| node_modules/csstype | 3.2.3 | MIT |
| node_modules/defu | 6.1.7 | MIT |
| node_modules/detect-libc | 2.1.2 | Apache-2.0 |
| node_modules/dts-resolver | 3.0.0 | MIT |
| node_modules/empathic | 2.1.0 | MIT |
| node_modules/entities | 7.0.1 | BSD-2-Clause |
| node_modules/es-module-lexer | 2.3.2 | MIT |
| node_modules/estree-walker | 3.0.3 | MIT |
| node_modules/expect-type | 1.4.0 | Apache-2.0 |
| node_modules/fdir | 6.5.0 | MIT |
| node_modules/fsevents | 2.3.3 | MIT |
| node_modules/get-tsconfig | 5.0.0-beta.5 | MIT |
| node_modules/happy-dom | 21.0.4 | MIT |
| node_modules/hookable | 6.1.2 | MIT |
| node_modules/import-without-cache | 0.4.1 | MIT |
| node_modules/lightningcss | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-android-arm64 | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 |
| node_modules/lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 |
| node_modules/magic-string | 0.30.21 | MIT |
| node_modules/nanoid | 3.3.19 | MIT |
| node_modules/obug | 2.2.1 | MIT |
| node_modules/pathe | 2.0.3 | MIT |
| node_modules/picocolors | 1.1.1 | ISC |
| node_modules/picomatch | 4.0.7 | MIT |
| node_modules/postcss | 8.5.28 | MIT |
| node_modules/quansync | 1.0.0 | MIT |
| node_modules/react | 19.3.0 | MIT |
| node_modules/react-dom | 19.3.0 | MIT |
| node_modules/resolve-pkg-maps | 1.0.0 | MIT |
| node_modules/rolldown | 1.2.9 | MIT |
| node_modules/rolldown-plugin-dts | 0.27.14 | MIT |
| node_modules/scheduler | 0.28.0 | MIT |
| node_modules/siginfo | 2.0.0 | ISC |
| node_modules/source-map-js | 1.2.1 | BSD-3-Clause |
| node_modules/stackback | 0.0.2 | MIT |
| node_modules/std-env | 4.2.0 | MIT |
| node_modules/tinybench | 2.9.0 | MIT |
| node_modules/tinyexec | 1.3.1 | MIT |
| node_modules/tinyglobby | 0.2.17 | MIT |
| node_modules/tinyrainbow | 3.1.1 | MIT |
| node_modules/tree-kill | 1.2.2 | MIT |
| node_modules/tsdown | 0.22.14 | MIT |
| node_modules/typescript | 5.9.3 | Apache-2.0 |
| node_modules/unconfig-core | 7.5.0 | MIT |
| node_modules/undici-types | 7.18.2 | MIT |
| node_modules/verkit | 0.3.2 | MIT |
| node_modules/vite | 8.3.0 | MIT |
| node_modules/vitest | 4.1.11 | MIT |
| node_modules/whatwg-mimetype | 3.0.0 | MIT |
| node_modules/why-is-node-running | 2.3.0 | MIT |
| node_modules/ws | 8.22.1 | MIT |
| node_modules/yaml | 2.9.1 | ISC |
| node_modules/yuku-ast | 0.8.7 | MIT |
| node_modules/yuku-codegen | 0.8.7 | MIT |
| node_modules/yuku-parser | 0.8.7 | MIT |
| node_modules/zod | 4.6.7 | MIT |

统计：160 条 lock 条目；105 条带许可文件；55 条未找到许可文件；51 条 optional；17 条 peer。

## 复核项

- 无 license 字段：0 条。
- 无许可文件：55 条（前 10 条：node_modules/@rolldown/binding-android-arm-eabi、node_modules/@rolldown/binding-android-arm64、node_modules/@rolldown/binding-darwin-arm64、node_modules/@rolldown/binding-darwin-x64、node_modules/@rolldown/binding-freebsd-x64、node_modules/@rolldown/binding-linux-arm-gnueabihf、node_modules/@rolldown/binding-linux-arm64-gnu、node_modules/@rolldown/binding-linux-arm64-musl、node_modules/@rolldown/binding-linux-ppc64-gnu、node_modules/@rolldown/binding-linux-s390x-gnu）。
- 漏洞扫描不在本清单范围；发布前另做 `npm audit` 与依赖复核。
- DSH peer 包由宿主提供，版本随宿主；不在本清单内。

# @manuscripts/track-changes-plugin

## 1.7.1

### Patch Changes

- d0f6665: LEAN-2752 Attributes tracking improvements

## 1.7.0

### Minor Changes

- 2577694: LEAN-2737

## 1.6.0

### Minor Changes

- 75916fa: LEAN-2508

## 1.5.2

### Patch Changes

- f0dff85: LEAN-2431 Text editing fixes
- f0dff85: LEAN-2431

## 1.5.0

### Minor Changes

- a860547: update json-schema and transform version

## 1.4.1

### Minor Changes

- 24038f1: LEAN-2429 - Editor freezes when inputting 2nd hard return

## 1.4.0

### Minor Changes

- 3a3bd11: LEAN-2430

## 1.3.1

### Patch Changes

- bd31a9b: update json-schema version

## 1.3.0

### Minor Changes

- 290d2fa: LEAN-2495 - update json-schema version

## 1.2.0

### Minor Changes

- f543f1b: LEAN-1967 - Fix: Multiple steps tracking

### Patch Changes

- 250d6d4: Dependencies to normals

## 1.1.0

### Minor Changes

- 6184cb2: LEAN-1967 - Fix: Multiple steps tracking

## 1.0.0

### Major Changes

- 10d9758: Update json-schema and transform versions

## 0.4.7

### Patch Changes

- 351c53e: LEAN-2099 - LW-R8: No new Suggestion appears in the History for the detach after replace from editor

## 0.4.6

### Patch Changes

- b4be932: LEAN-1998 - Fix node selection check

## 0.4.5

### Patch Changes

- 3db2ab4: LEAN-1839 - Fix for comment markers

## 0.4.4-LEAN-1839-v3

### Minor Changes

- 80562e8: LEAN-1839 - Fix for comment markers

## 0.4.4-LEAN-1839-v2

### Minor Changes

- a96c272: LEAN-1839 - Fix for comment markers

## 0.4.4-LEAN-1839

### Minor Changes

- 9dddd9f: LEAN-1839 - Fix for comment markers

## 0.4.4

### Patch Changes

- 5818070: fix(track): add cjs to package.json exports

## 0.4.3

### Patch Changes

- 5e392d2: fix(track): dont delete table content when attribute updated
- ed33757: refactor(track): remove unneeded merge marks, add failing test case for a bug that I found

## 0.4.2

### Patch Changes

- 9cabcf3: fix(track): diff yet again, also selection pos when diffed

## 0.4.1

### Patch Changes

- 8a9c759: fix(track): prevent infinite loops by checking for undefined in diff
- ad87378: refactor(track): remove duplicated code, modify update change-step
- baf766c: fix(track): diff from start instead of end since it's better UX
- cdde368: refactor(track): switch to using list for node dataTracked attributes

## 0.4.0

### Minor Changes

- b5968df: feat: add diffing of transactions

### Patch Changes

- 1444126: refactor(track): rename & move files to improve readability

## 0.3.0

### Minor Changes

- b774a07: breaking: refactor userID to authorID, add reviewedById & updatedAt to trackedAttrs
- e874c4d: refactor(track): BREAKING expose skipTracking instead of setAction

### Patch Changes

- 207178c: fix(track): set reviewedByID as optional since ProseMirror doesnt like persisting null values
- 566e3a2: fix(track): set reviewedByID when status is changed

## 0.2.0

### Minor Changes

- 75be881: fix(track): track links properly, improve maintaining NodeSelection

## 0.1.1

### Patch Changes

- 4985cd8: fix(track): types & add typecheck command, run lint

## 0.1.0

### Minor Changes

- 73399a3: refactor: update ProseMirror deps to new TS-based versions, making @types packages unneeded

### Patch Changes

- 15ecb6e: fix(track): tests, invalid TextSelections, some types
- d7a8de6: fix(track): check targetDepth for null to avoid throwing errors on tr.lift
- 8bb1f4a: test(track): downgrade jest to 27 to use manuscript-transform in tests

## 0.0.4

### Patch Changes

- f12b327: fix(track): dont copy meta-keys to created new transaction as it might cause race-conditions

## 0.0.3

### Patch Changes

- e0d285d: fix: in track-changes-plugin check whether node was deleted when applying node changes

## 0.0.2

### Patch Changes

- 5269319ba: Update READMEs, add documentation on releasing with changesets

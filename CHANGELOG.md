# @manuscripts/track-changes-plugin

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

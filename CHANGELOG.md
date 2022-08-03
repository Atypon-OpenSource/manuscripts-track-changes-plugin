# @manuscripts/track-changes-plugin

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

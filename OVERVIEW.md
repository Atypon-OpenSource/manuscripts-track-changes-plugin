# Overview

The plugin works by adding attributes to nodes as `dataTracked` objects and wrapping text with `tracked_insert` and `tracked_delete` marks. You can find an example schema [here](https://github.com/Atypon-OpenSource/manuscripts-quarterback/blob/main/quarterback-packages/track-changes-plugin/test/utils/schema.ts). In addition to adding `dataTracked` objects and `tracked_insert` and `tracked_delete` marks, `code_block` marks were altered to include track marks: `marks: 'tracked_insert tracked_delete'`.

This library replaces a previous implementation https://gitlab.com/mpapp-public/manuscripts-track-changes based on commits as in https://prosemirror.net/examples/track/ which proved unreliable due to non-idempotent nature of transactions when rebased as well as the inability to transition to Yjs syncing. `prosemirror-changeset` was also [trialed](https://teemukoivisto.github.io/prosemirror-track-changes-example/) but it had similar problems and was deemed hard to extend to include tracking formatting changes.

On a more detailed level, this plugin checks every transaction in an `appendTransaction` hook for modifications to the document (`tr.docChanged`). If they exist, it prevents that transaction by inverting it and then reapplys it with deletions and insertions wrapped in track attributes/marks. This can be bybassed by using `skipTracking(tr)` action or by setting `skipTrsWithMetas?: (PluginKey | string)[]` option to skip all transactions based on their meta fields, such as `ySyncPluginKey`. This prevents race conditions where appendTransactions keep firing between 2 or more plugins. `prosemirror-history` transactions are skipped by default.

On every transaction prevented, ChangeSet is generated which contains all the changes as a flat list found from the document. The plugin iterates the whole document with `doc.descendants` which can add latency when working on larger docs. Important to note when working with changes is their hierarchial nature. A block node change might span multiple other changes which, if the node change is applied, might automatically cancel any nested changes. `changeTree` property is therefore computed to show the change as 1-level tree in the example app's UI.

Yjs collaboration works without further integration with this attribute & mark based approach. However, due to missing feature-parity with Yjs documents and ProseMirror documents it currently does not behave consistently. Notably, Yjs snapshots do not show node attributes which makes using them for viewing snapshots insufficient. Yjs nodes can't also contain marks but this was circumvented by using node attributes for inline nodes too.

The plugin also includes logging using `debug` library that can be toggled with either passing `debug?: boolean` option or executing `enableDebug(enabled: boolean)`.

CKEditor and Fiduswriter served as its inspiration but everything was written from scratch. Also, this library is open-sourced under the Apache 2 license.

## Feature summary

- tracks block, inline, atom node inserts & deletes as `dataTracked` attribute objects
- tracks text insert & delete as `tracked_insert` and `tracked_delete` marks
- joins track marks based on `userID`, `operation` and `status`, uses the oldest `createdAt` value as timestamp
- allows deletes of block nodes & text if operation is `inserted`
- does not diff operations next to each other eg `(ins aasdf)(del asdf)` is not reduced to `ins a`
- does not track block node attribute updates
- does not track mark inserts & deletes
- does not track ReplaceAroundSteps
- has probably bugs regarding the edge cases around copy-pasting complicated slices

## Roadmap

- track block node attribute updates, they currently go undetected
- test copy-pasting works (slices with varying open endedness)
- test for race conditions
- more thorough tests
- track formatting changes, basically handle AddMarkStep and RemoveMarkSteps

## Related reading

- https://ckeditor.com/docs/ckeditor5/latest/features/collaboration/track-changes/track-changes.html
- https://ckeditor.com/blog/ckeditor-5-comparing-revision-history-with-track-changes/
- https://github.com/fiduswriter/fiduswriter
- https://www.ncbi.nlm.nih.gov/books/NBK159965/
- https://teemukoivisto.github.io/prosemirror-track-changes-example/
- https://demos.yjs.dev/prosemirror-versions/prosemirror-versions.html
- https://slab.com/blog/announcing-delta-for-elixir/
- https://www.inkandswitch.com/peritext/

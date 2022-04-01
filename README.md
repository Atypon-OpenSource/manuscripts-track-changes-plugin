# @manuscripts/track-changes-plugin

This is a ProseMirror plugin that tracks inserts/deletes to nodes and text.

It uses node attributes inside `dataTracked` object to persist changes for both block and inline nodes and `tracked_insert` & `tracked_delete` marks for text. An example implementation can be found inside the `examples-packages/schema` package. In addition to `dataTracked`, `tracked_insert` and `tracked_delete` code_blocks marks were altered to include track marks: `marks: 'tracked_insert tracked_delete'`. If you have multiple versions of prosemirror packages, ensure that track-changes' dependencies `prosemirror-model` and `prosemirror-transform` are aliased/deduped to same instance. `prosemirror-state` and `prosemirror-view` are only used at type level.

This library replaces a previous implementation based on commits as in https://prosemirror.net/examples/track/ which proved unreliable due to non-idempotent nature of transactions when rebased as well as the inability to transition to Yjs syncing. `prosemirror-changeset` was also trialed but it had similar problems and was deemed hard to extend to include tracking formatting changes.

On a more detailed level, this plugin checks every transaction in an `appendTransaction` hook for any modifications to the document (`tr.docChanged`). If they exist, it prevents that transaction from happening by inverting it and reapplying it with deletions and insertions wrapped in track attributes/marks. It can be bybassed by using `TrackActions.skipTrack` action or by setting `skipTrsWithMetas?: (PluginKey | string)[]` option to skip all transactions based on their meta fields, such as `ySyncPluginKey`. This prevents race conditions where appendTransactions keep firing between 2 or more plugins. `prosemirror-history` transactions are skipped by default.

On every transaction prevented, ChangeSet is generated which contains all the changes found from the document. `tr.setMeta('origin', trackChangesPluginKey)` is applied to id the transaction. Whole document is currently being iterated which may be somewhat inefficient on larger docs. The changes are stored as a flat list yet due to the hierarchy of the changes, a `changeTree` property is generated which wraps all changes within a node change as its children. This is especially helpful when inserting/deleting nodes that require multiple children that are irrelevant to the user. Currently, they are still shown in the example UI but future enhancements will probably hide them. Granular controls are however at times needed when some of the changes can be considered separate or non-contiguous.

Yjs collaboration works without further integration with this attribute & mark based approach. However, due to missing feature-parity with Yjs documents and ProseMirror documents it currently does not behave consistently. Notably, Yjs snapshots do not show node attributes which makes using them for viewing snapshots insufficient. Yjs nodes can't also contain marks but this was circumvented by using node attributes for inline nodes too.

The plugin also includes logging using `debug` library that can be toggled with either passing `debug?: boolean` option or executing `enableDebug(enabled: boolean)`.

CKEditor and Fiduswriter served as its inspiration but everything was written from scratch. Also, this library is open-sourced under the Apache 2 license.

## API

As copied from the source.

```ts
export const trackChangesPluginKey = new PluginKey<TrackChangesState, any>('track-changes')

/**
 * The ProseMirror plugin needed to enable track-changes.
 * 
 * Accepts an empty options object as an argument but note that this uses 'anonymous:Anonymous' as the default userID.
 * @param opts
 */
export const trackChangesPlugin = (opts?: TrackChangesOptions) => Plugin<TrackChangesState, any>

export interface TrackChangesOptions {
  debug?: boolean
  userID: string
  skipTrsWithMetas?: (PluginKey | string)[]
}
export interface TrackChangesState {
  status: TrackChangesStatus
  userID: string
  changeSet: ChangeSet
}
export enum TrackChangesStatus {
  enabled = 'enabled',
  viewSnapshots = 'view-snapshots',
  disabled = 'disabled',
}

export const enableDebug = (enabled: boolean) => void
```

### Commands

```ts
/**
 * Sets track-changes plugin's status to any of: 'enabled' 'disabled' 'viewSnapshots'. Passing undefined will
 * set 'enabled' status to 'disabled' and 'disabled' | 'viewSnapshots' status to 'enabled'.
 *
 * In disabled view, the plugin is completely inactive and changes are not updated anymore.
 * In viewSnasphots state, editor is set uneditable by editable prop that allows only selection changes
 * to the document.
 * @param status
 */
export const setTrackingStatus = (status?: TrackChangesStatus) => Command

/**
 * Appends a transaction to set change attributes/marks' statuses to any of: 'pending' 'accepted' 'rejected'.
 * @param status
 * @param ids
 */
export const setChangeStatuses = (status: CHANGE_STATUS, ids: string[]) => Command

/**
 * Sets track-changes plugin's userID.
 * @param userID
 */
export const setUserID = (userID: string) => Command

/**
 * Appends a transaction that applies all 'accepted' and 'rejected' changes to the document.
 */
export const applyAndRemoveChanges = () => Command

/**
 * Runs `findChanges` to iterate over the document to collect changes into a new ChangeSet.
 */
export const refreshChanges = () => Command
```

### Actions

Actions are used to access/set transaction meta fields. I don't think you ever would need to use other than `TrackChangesAction.skipTrack` but they are all exposed, nonetheless.

```ts
export type TrackChangesActionParams = {
  [TrackChangesAction.skipTrack]: boolean
  [TrackChangesAction.setUserID]: string
  [TrackChangesAction.setPluginStatus]: TrackChangesStatus
  [TrackChangesAction.setChangeStatuses]: {
    status: CHANGE_STATUS
    ids: string[]
  }
  [TrackChangesAction.updateChanges]: string[]
  [TrackChangesAction.refreshChanges]: boolean
  [TrackChangesAction.applyAndRemoveChanges]: boolean
}
/**
 * Gets the value of a meta field, action payload, of a defined track-changes action.
 * @param tr 
 * @param action 
 */
export function getAction<K extends keyof TrackChangesActionParams>(tr: Transaction, action: K) {
  return tr.getMeta(action) as TrackChangesActionParams[K] | undefined
}

/**
 * Use this function to set meta keys to transactions that are consumed by the track-changes-plugin.
 * For example, you can skip tracking of a transaction with setAction(tr, TrackChangesAction.skipTrack, true)
 * @param tr 
 * @param action 
 * @param payload 
 */
export function setAction<K extends keyof TrackChangesActionParams>(
  tr: Transaction,
  action: K,
  payload: TrackChangesActionParams[K]
) {
  return tr.setMeta(action, payload)
}
```

### Types

Can be found in `./src/types` and `./src/ChangeSet.ts`

## Feature summary

* tracks block, inline, atom node inserts & deletes as `dataTracked` attribute objects
* tracks text insert & delete as `tracked_insert` and `tracked_delete` marks
* joins track marks based on `userID`, `operation` and `status`, uses the oldest `createdAt` value as timestamp
* allows deletes of block nodes & text if operation is `inserted`
* does not diff operations next to each other eg `(ins aasdf)(del asdf)` is not reduced to `ins a`
* does not track block node attribute updates
* does not track mark inserts & deletes
* does not track ReplaceAroundSteps
* has probably bugs regarding the edge cases around copy-pasting complicated slices

## Roadmap

* track block node attribute updates, they currently go undetected
* test copy-pasting works (slices with varying open endedness)
* test for race conditions
* refactor unused code, add better comments
* more thorough tests
* track ReplaceAroundSteps
* track formatting changes, basically handle AddMarkStep and RemoveMarkSteps

## Related reading

* https://ckeditor.com/docs/ckeditor5/latest/features/collaboration/track-changes/track-changes.html
* https://ckeditor.com/blog/ckeditor-5-comparing-revision-history-with-track-changes/
* https://github.com/fiduswriter/fiduswriter
* https://www.ncbi.nlm.nih.gov/books/NBK159965/
* https://teemukoivisto.github.io/prosemirror-track-changes-example/
* https://demos.yjs.dev/prosemirror-versions/prosemirror-versions.html
* https://slab.com/blog/announcing-delta-for-elixir/
* https://www.inkandswitch.com/peritext/
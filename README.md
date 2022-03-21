# @manuscripts/track-changes-plugin

This is a ProseMirror plugin that tracks inserts/deletes to nodes and text.

It uses node attributes inside `dataTracked` object to persist changes for both block and inline nodes and `tracked_insert` & `tracked_delete` marks for text. An example implementation can be found inside the `examples-packages/schema` package. This library and approach replaces a previous implementation based on commits as in the https://prosemirror.net/examples/track/ example which proved unreliable due to non-idempotent nature of transactions when rebased as well as inability to use Yjs collaboration with the approach. `prosemirror-changeset` was also trialed by which had similar problems as well as being hard to extend for formatting changes.

On a more detailed level, this plugin checks every transaction in an `appendTransaction` hook for any modifications to the document (`tr.docChanged`). If they exist, it prevents that transaction from happening by inverting it and reapplying it with deletions and insertions wrapped in track attributes/marks. Importantly this can be bybassed by using `TrackActions.skipTrack` action to prevent race conditions where appendTransactions keep firing between 2 or more plugins. Or be setting `skipTrsWithMetas?: (PluginKey | string)[]` option parameter to skip all transactions based on their meta fields, such as `ySyncPluginKey`. By default `prosemirror-history` transactions are skipped.

On every transaction prevented, ChangeSet is generated which contains all the changes found from the document. `tr.setMeta('origin', trackChangesPluginKey)` is applied to id the transaction. Whole document is currently being iterated which may be somewhat inefficient on larger docs. The changes are stored as a flat list yet due to the hierarchy of the changes, a `changeTree` property is generated which wraps all changes within a node change as its children. This is especially helpful when inserting/deleting nodes that require multiple children that are irrelevant to the user. Currently, they are still shown in the UI but future enhancements will probably hide them. Granular controls are however at times needed when some of the changes can be considered separate or non-contiguous.

Yjs collaboration works without further integration with this attribute & mark based approach. However, due to missing feature-parity with Yjs documents and ProseMirror documents it currently does not behave consistently. Notably, Yjs snapshots do not show node attributes which makes using them for showing snapshots insufficient. Yjs nodes can't also contain marks but this was circumvented by using node attributes for inline nodes too.

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
  shownChangeStatuses: CHANGE_STATUS[]
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
 * Sets tracking status between 'enabled' 'disabled' 'viewSnapshots'
 * In disabled view, the plugin is completely inactive. In viewSnasphots state,
 * editor is set uneditable by editable prop that allows only selection changes to the
 * document.
 * @param status
 */
export const setTrackingStatus = (status?: TrackChangesStatus) => Command

/**
 * Sets change statuses between 'pending' 'accepted' and 'rejected'
 * @param status
 * @param ids
 */
export const setChangeStatuses = (status: CHANGE_STATUS, ids: string[]) => Command

/**
 * Sets track user's ID.
 * @param userID
 */
export const setUserID = (user: TrackedUser) => Command

/**
 * Filters shown change statuses ('pending','accepted','rejected') from the change list.
 * @param statuses 
 */
export const toggleShownStatuses = (statuses: CHANGE_STATUS[]) => Command

/**
 * Applies current accepted and rejected changes to the document.
 */
export const applyAndRemoveChanges = () => Command

/**
 * Iterates over the doc and collects the changes into a new ChangeSet.
 */
export const refreshChanges = () => Command
```

### Actions

Actions are used to access/set transaction meta fields.

```ts
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

## Roadmap

* track node attribute updates, mandatory for say tracking image URL changes
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
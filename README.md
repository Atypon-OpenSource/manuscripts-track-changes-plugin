# [@manuscripts/track-changes-plugin](https://github.com/Atypon-OpenSource/manuscripts-quarterback/tree/main/quarterback-packages/track-changes-plugin)

ProseMirror plugin to track inserts/deletes to nodes and text.

## How to use

Requires normal ProseMirror editor dependencies.

1. Install the plugin: `npm i @manuscripts/track-changes-plugin`
2. Add it to ProseMirror plugins:

```ts
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { exampleSetup } from 'prosemirror-example-setup'
import { trackChangesPlugin } from '@manuscripts/track-changes-plugin'

import { schema } from './schema'

const plugins = exampleSetup({ schema }).concat(
  trackChangesPlugin({
    debug: true,
  })
)
const state = EditorState.create({
  schema,
  plugins,
})
const view = new EditorView(document.querySelector('#editor') as HTMLElement, {
  state,
})
```

where `schema` contains `dataTracked` attributes for tracked nodes and `tracked_insert` & `tracked_delete` marks as shown here: https://github.com/Atypon-OpenSource/manuscripts-quarterback/blob/main/quarterback-packages/track-changes-plugin/test/utils/schema.ts

3. That should start tracking all transactions. You can use the following commands to enable/disable/enter read-only mode:

```ts
import { trackCommands, TrackChangesStatus } from '@manuscripts/track-changes-plugin'

// toggle
trackCommands.setTrackingStatus())(view.state, view.dispatch, view)

// enable
trackCommands.setTrackingStatus(TrackChangesStatus.enabled))(view.state, view.dispatch, view)

// disable
trackCommands.setTrackingStatus(TrackChangesStatus.disabled))(view.state, view.dispatch, view)

// sets editor's 'editable' prop to false, making it ready-only
trackCommands.setTrackingStatus(TrackChangesStatus.viewSnapshots))(view.state, view.dispatch, view)
```

See an example app at https://github.com/Atypon-OpenSource/manuscripts-quarterback/tree/main/examples-packages/client for a more complete boilerplate.

**NOTE**: If you have multiple versions of prosemirror packages, ensure that track-changes' dependencies `prosemirror-model` and `prosemirror-transform` are aliased/deduped to same instance. `prosemirror-state` and `prosemirror-view` are only used at type level. [Example](https://github.com/Atypon-OpenSource/manuscripts-quarterback/blob/main/examples-packages/client/vite.config.js).

[More detailed overview](https://github.com/Atypon-OpenSource/manuscripts-quarterback/blob/main/quarterback-packages/track-changes-plugin/OVERVIEW.md)

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

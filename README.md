# [@manuscripts/track-changes-plugin](https://github.com/Atypon-OpenSource/manuscripts-quarterback/tree/main/quarterback-packages/track-changes-plugin)

ProseMirror plugin designed to track changes within a document, similar to the track changes functionality found in Google Docs or Microsoft Word. It allows for the tracking of insertions and deletions of nodes, text and node attributes, preserving information about past changes using dataTracked attributes on nodes.

## Features

1. **Tracking of Changes:** Monitors and records insertions and deletions of block nodes, inline nodes, attributes on nodes and text within the ProseMirror editor.
2. **Changes management:** Allows to reject/accept a single change or a list of changes.
3. **Command Set:** Provides commands to enable, disable, skip, accept, reject changes. Commands are issues as transactions meta. This is the way to communicate with the plugin.
4. **Interpretation:** Plugin provides a ChangeSet class that helps to interpret changes in a user-friendly way.

## Core Architecture Overview

### Main design points

- Intercept transactions (insert/delete).
  Transactions are intercepted and reverted using default plugins lifecycle, unless transaction has meta commanding to skip tracking.

- Annotate changes with metadata using node attributes and marks.
  Before transaction is reverted the changes in each step of transaction are processed and created metadata that described the changes are stored in the dataTracked attributes. For text changes, dataTracked attributes are added to marks,
  with which the inline change is marked on the document. For node changes the dataTracked metadata are assigned to nodes.

- ChangeSet class handles changes interpretation to create a more meaningful representation:
  - Creates a list of top level changes out of a list of nested changed.
  - Groups adjacent inline change of to create a single change
  - Provides utilities to process changes, such as checking the type of a change, checking validity, flattening, etc.
- Changes acceptance/rejection in the document is executed via commands. Accepting a change means integrating the change into the document and discarding metadata about it.
  Rejecting the change means reverting to the state of nodes or text or attributes before the change and discarding metadata about it.
- History of edits (who, what, when) is supported only in the boundaries of dataTracked attributes metadata. The plugin doesn't provide Undo/Redo capabilities but perfectly compatible with default prosemirror-history plugin.

### How it works under the hood

1. Transaction intercepted and decided upon if needs to be tracked or not. Done in appendTransaction method of the plugin. Besides explicit disabling there is a number of internal cases that disables tracking
2. Each type of prosemirror change step type is processed by differently. **trackTransaction** function invokes a function for each of those, such as trackReplaceStep or trackReplaceAroundStep.
   While all of these step processing functions are a bit different, all of them result in returning an array of **ChangeStep**
3. **ChangeSteps** have high descriptive value and represent a specific change. This process is required because prosemirror steps are designed to efficiently capture a change in the document structure but are hard to reason about because they don't really correspond to meaningful user actions directly. There also cases when something, what we consider to be a single step of change, is represented by multiple changes. See ChangeStep type for details.
4. ChangeSteps are then processed by diffChangeSteps function. The function attempts to match inserted content with previously deleted content, so it can detect and consolidate edits rather than treat all changes as new inserts.
5. Finally, changes produced from ChangeSteps are recreated on the prosemirror document along with appropriate metadata (see **processChangeSteps** function) and a new transaction is issued to apply them. Note that some metadata are created in steps processing function.
6. Due to the fact that we revert changes from original transaction and then apply new changes with both old state and new state of affected node/text, the current selection on the document may be misplaced. Because of that, in some cases, we repair the selection to match its position as expected by the user.

### Basic DataTracked Attributes Model

Nodes that change are extended with dataTracked attributes:

```ts
{ "dataTracked": [ { "id": "uuid", "user": "anonymous", "timestamp": 123456789, "operation": "insert" | "delete" | "set_attrs" | "wrap_with_node" ... } ] }
```

## Requirements

Node schema needs to have { dataTracked: null } attribute declared. Otherwise the node will not be tracked.

## Best practices and caveats

Storing metadata about changes directly in the document as an attributes provides a lot of advantages (simple data model is one of them) but also has a caveat of treating metadata as data. Unless treated with care, complex changes may result in a loss of metadata during processing. Prosemirror doesn't do deepCloning of attributes between states so it would be a good practice to treat attributes with care and avoiding mutation of attributes to avoid weird behaviour.

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
 * Runs `findChanges` to iterate over the document to collect changes into a new ChangeSet.
 */
export const refreshChanges = () => Command
```

### Actions

Actions are used to access/set transaction meta fields internally. `skipTracking` is exposed publicly to set track-changes to skip certain transaction.

```ts
/**
 * Skip tracking for a transaction, use this with caution to avoid race-conditions or just to otherwise
 * omitting applying of track attributes or marks.
 * @param tr
 * @returns
 */
export const skipTracking = (tr: Transaction) => setAction(tr, TrackChangesAction.skipTrack, true)
```

### Types

Can be found in `./src/types` and `./src/ChangeSet.ts`

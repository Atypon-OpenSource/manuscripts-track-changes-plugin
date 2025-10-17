/*!
 * © 2025 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EditorState, Transaction } from 'prosemirror-state'
import { Change, CHANGE_STATUS, IncompleteChange, TrackedChange } from '../types/change'
import {
  Mapping,
  ReplaceStep,
  ReplaceAroundStep,
  Step,
  AddMarkStep,
  AddNodeMarkStep,
  RemoveNodeMarkStep,
  RemoveMarkStep,
  AttrStep,
  DocAttrStep,
} from 'prosemirror-transform'
import { Schema } from 'prosemirror-model'
import { ChangeSet } from '../ChangeSet'
import { TrTrackingContext } from '../types/track'

/**
 *
 * This refactoring has to address the followin problems:
 *
 * 1. When implementing/debugging support for a given type of prosemirror step all things that
 *    need to be support are scattered and it's not clear where to look for. There is
 *    - processing of an incoming transaction and creating of a change-step
 *    - diff-ing of a steps to avoid producing duplicated steps (mostly for text changes)
 *    - a function to update dataTracked attributes (updateChangeAttrs) that also handles restoration of them
 *    - a function to apply or revert pending change
 *    - some data interpretation is scattered in body editor and article editor
 *      1) article-editor does some check to understand how to represent changes
 *      2) body-editor is hyper aware of the internal of tc plugin - it does shadow node checks and refChangesChecks
 *    - ability to create complex changes have to be separated and constitute a layer in relation to simple changes
 *      for example when we move a node we first need to create a deletion and an insertion and then post-process it into a single change
 *
 *
 *      Implementation plan:
 *
 *      1. Define contract of Interpreter class
 *      2. Do we actually needs change-steps that we create midway between a change and prosemirror's step?
 *      3. Allow better abstraction in body-editor
 */

abstract class ChangeOwner<T extends Change> {
  type: T

  constructor() {
    this.type = T
  }

  // abstract onReplaceStep?(step: ReplaceStep, i: number, tr: Transaction): void
  // abstract onReplaceAroundStep?(step: ReplaceAroundStep, i: number, tr: Transaction): void
  // abstract onAddMarkStep?(step: AddMarkStep, i: number, tr: Transaction): void
  // abstract onAddNodeMarkStep?(step: AddNodeMarkStep, i: number, tr: Transaction): void
  // abstract onRemoveNodeMarkStep?(step: RemoveNodeMarkStep, i: number, tr: Transaction): void
  // abstract onRemoveMarkStep?(step: RemoveMarkStep, i: number, tr: Transaction): void
  // abstract onAttrStep?(step: AttrStep, i: number, tr: Transaction): void
  // abstract onDocAttrStep?(step: DocAttrStep, i: number, tr: Transaction): void

  /**
   * Called when a user approves a change in the document and it needs to become a part of the document
   */
  abstract applyChange() {
    //   abstract applyAcceptedRejectedChanges(
    //   tr: Transaction,
    //   schema: Schema,
    //   changes: TrackedChange[],
    //   changeSet: ChangeSet,
    //   deleteMap: Mapping
    // ): Mapping
  }

  /**
   * Called when a user rejects a change in the document
   */
  abstract revertChange(tr: Transaction, change: IncompleteChange, changeSet: ChangeSet, deleteMap: Mapping)

  abstract updateChangeStatus(
    createdTr: Transaction,
    changeSet: ChangeSet,
    ids: string[],
    status: CHANGE_STATUS,
    userID: string,
    oldState: EditorState
  ): void
}

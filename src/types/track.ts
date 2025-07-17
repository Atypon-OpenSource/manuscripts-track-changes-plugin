/*!
 * © 2023 Atypon Systems LLC
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
import { Fragment, Node as PMNode } from 'prosemirror-model'
import type { PluginKey } from 'prosemirror-state'
import { ReplaceAroundStep } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { CHANGE_OPERATION, CHANGE_STATUS, TrackedAttrs } from './change'

export interface TrackChangesOptions {
  debug?: boolean
  userID: string
  skipTrsWithMetas?: (PluginKey | string)[]
  initialStatus?: TrackChangesStatus
}

export interface TrackChangesState {
  status: TrackChangesStatus
  userID: string
  changeSet: ChangeSet
}

export type NewEmptyAttrs = Omit<TrackedAttrs, 'id' | 'operation'>
export type NewInsertAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.insert | CHANGE_OPERATION.wrap_with_node | CHANGE_OPERATION.move
}

export type NewDeleteAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.delete
}
export type NewUpdateAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.set_node_attributes
  oldAttrs: Record<string, any>
}
export type NewSplitNodeAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.node_split
}
export type NewReferenceAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.reference
  referenceId: string
}
export type NewStructureAttrs = Omit<TrackedAttrs, 'id' | 'operation'> & {
  operation: CHANGE_OPERATION.structure
  action: 'convert-to-paragraph' | 'convert-to-section' | 'indent-section' | 'unindent-section'
  index: number
  parentId?: string
}
export type NewTrackedAttrs = NewInsertAttrs | NewDeleteAttrs | NewUpdateAttrs | NewStructureAttrs

export enum TrackChangesStatus {
  enabled = 'enabled',
  viewSnapshots = 'view-snapshots',
  disabled = 'disabled',
}

export type TrTrackingContext = {
  prevLiftStep?: ReplaceAroundStep
  liftFragment?: Fragment
}

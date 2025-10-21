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
import { Fragment } from 'prosemirror-model'
import type { PluginKey } from 'prosemirror-state'
import { Mapping, ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { getAction } from '../actions'

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

export enum TrackChangesStatus {
  enabled = 'enabled',
  viewSnapshots = 'view-snapshots',
  disabled = 'disabled',
}

export type TrTrackingContext = {
  prevLiftStep?: ReplaceAroundStep
  liftFragment?: Fragment
  action: ReturnType<typeof getAction>
  // emptyAttrs: NewEmptyAttrs
  stepsByGroupIDMap: Map<ReplaceStep, string>
  selectionPosFromInsertion?: number
}

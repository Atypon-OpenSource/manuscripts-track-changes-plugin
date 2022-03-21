/*!
 * © 2021 Atypon Systems LLC
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
import { Transaction } from 'prosemirror-state'

import { CHANGE_STATUS } from './types/change'
import { TrackChangesStatus } from './types/track'

export enum TrackChangesAction {
  skipTrack = 'track-changes-skip-tracking',
  setUserID = 'track-changes-set-user-id',
  setPluginStatus = 'track-changes-set-track-status',
  setChangeStatuses = 'track-changes-set-change-statuses',
  updateChanges = 'track-changes-update-changes',
  refreshChanges = 'track-changes-refresh-changes',
  applyAndRemoveChanges = 'track-changes-apply-remove-changes',
}

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

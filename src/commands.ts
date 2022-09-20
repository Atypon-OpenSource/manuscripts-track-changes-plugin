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
import { Command } from 'prosemirror-state'
import { setAction, TrackChangesAction } from './actions'
import { trackChangesPluginKey } from './plugin'
import { CHANGE_STATUS } from './types/change'
import { TrackChangesStatus } from './types/track'

/**
 * Sets track-changes plugin's status to any of: 'enabled' 'disabled' 'viewSnapshots'. Passing undefined will
 * set 'enabled' status to 'disabled' and 'disabled' | 'viewSnapshots' status to 'enabled'.
 *
 * In disabled view, the plugin is completely inactive and changes are not updated anymore.
 * In viewSnasphots state, editor is set uneditable by editable prop that allows only selection changes
 * to the document.
 * @param status
 */
export const setTrackingStatus =
  (status?: TrackChangesStatus): Command =>
  (state, dispatch) => {
    const currentStatus = trackChangesPluginKey.getState(state)?.status
    if (currentStatus) {
      let newStatus = status
      if (newStatus === undefined) {
        newStatus =
          currentStatus === TrackChangesStatus.enabled
            ? TrackChangesStatus.disabled
            : TrackChangesStatus.enabled
      }
      dispatch && dispatch(setAction(state.tr, TrackChangesAction.setPluginStatus, newStatus))
      return true
    }
    return false
  }

/**
 * Appends a transaction to set change attributes/marks' statuses to any of: 'pending' 'accepted' 'rejected'.
 * @param status
 * @param ids
 */
export const setChangeStatuses =
  (status: CHANGE_STATUS, ids: string[]): Command =>
  (state, dispatch) => {
    dispatch &&
      dispatch(
        setAction(state.tr, TrackChangesAction.setChangeStatuses, {
          status,
          ids,
        })
      )
    return true
  }

/**
 * Sets track-changes plugin's userID.
 * @param userID
 */
export const setUserID =
  (userID: string): Command =>
  (state, dispatch) => {
    dispatch && dispatch(setAction(state.tr, TrackChangesAction.setUserID, userID))
    return true
  }

/**
 * Appends a transaction that applies all 'accepted' and 'rejected' changes to the document.
 */
export const applyAndRemoveChanges = (): Command => (state, dispatch) => {
  dispatch && dispatch(setAction(state.tr, TrackChangesAction.applyAndRemoveChanges, true))
  return true
}

/**
 * Runs `findChanges` to iterate over the document to collect changes into a new ChangeSet.
 */
export const refreshChanges = (): Command => (state, dispatch) => {
  dispatch && dispatch(setAction(state.tr, TrackChangesAction.refreshChanges, true))
  return true
}

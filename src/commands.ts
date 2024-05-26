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
import { schema } from '@manuscripts/transform'
import { NodeType } from 'prosemirror-model'
import { Command } from 'prosemirror-state'

import { setAction, skipTracking, TrackChangesAction } from './actions'
import { trackChangesPluginKey } from './plugin'
import { CHANGE_STATUS, NodeTypeChange, TrackedChange } from './types/change'
import { NewEmptyAttrs, TrackChangesStatus } from './types/track'
import { createNewUpdateType } from './utils/track-utils'
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
    const tr = state.tr
    const nodeTypeChanges = trackChangesPluginKey.getState(state)?.changeSet.nodeTypeChange
    if (nodeTypeChanges) {
      nodeTypeChanges.map((change: TrackedChange) => {
        if (ids.includes(change.id)) {
          let node = state.doc.nodeAt(change.from)
          if (status == 'pending' && node) {
            console.log('is pending', change)
            let oppositeType =
              node?.type !== schema.nodes.bullet_list ? schema.nodes.bullet_list : schema.nodes.ordered_list
            tr.setMeta(TrackChangesAction.updateNodeType, true).setNodeMarkup(
              change.from,
              oppositeType,
              node.attrs,
              node.marks
            )
          } else if (status == 'rejected' && node) {
            skipTracking(
              tr.setNodeMarkup(
                change.from,
                state.doc.nodeAt(change.from)?.type.schema.nodes[(change as NodeTypeChange).oldAttrs],
                node.attrs,
                node.marks
              )
            )
          }
        }
      })
    }

    dispatch &&
      dispatch(
        setAction(tr, TrackChangesAction.setChangeStatuses, {
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

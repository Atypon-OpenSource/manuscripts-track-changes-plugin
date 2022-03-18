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

import { setAction, TrackChangesAction } from './actions'
import { trackChangesPluginKey } from './plugin'
import { applyAndMergeMarks, deleteAndMergeSplitBlockNodes } from './track/trackTransaction'
import { CHANGE_OPERATION, CHANGE_STATUS } from './types/change'
import type { Command } from './types/editor'
import { ExposedSlice } from './types/pm'
import { DeleteAttrs, InsertAttrs, TrackChangesStatus } from './types/track'
import { TrackedUser } from './types/user'
import { uuidv4 } from './utils/uuidv4'

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

export const setInserted = (): Command => (state, dispatch) => {
  const pluginState = trackChangesPluginKey.getState(state)
  if (!pluginState) {
    return false
  }
  const { currentUser, insertColor, deleteColor } = pluginState
  const tr = state.tr
  const { from, to } = state.selection
  const insertAttrs: InsertAttrs = {
    userID: currentUser.id,
    userName: currentUser.name,
    time: tr.time,
    operation: CHANGE_OPERATION.insert,
    status: CHANGE_STATUS.pending,
  }
  const userColors = {
    userID: currentUser.id,
    userName: currentUser.name,
    insertColor,
    deleteColor,
  }
  applyAndMergeMarks(from, to, state.doc, tr, state.schema, insertAttrs, userColors)
  dispatch && dispatch(tr)
  return true
}

export const setDeleted = (): Command => (state, dispatch) => {
  const pluginState = trackChangesPluginKey.getState(state)
  if (!pluginState) {
    return false
  }
  const { currentUser, insertColor, deleteColor } = pluginState
  const tr = state.tr
  const { from, to } = state.selection
  const deleteAttrs: DeleteAttrs = {
    userID: currentUser.id,
    userName: currentUser.name,
    time: tr.time,
    operation: CHANGE_OPERATION.delete,
    status: CHANGE_STATUS.pending,
  }
  const userColors = {
    userID: currentUser.id,
    userName: currentUser.name,
    insertColor,
    deleteColor,
  }
  const { deleteMap, newSliceContent } = deleteAndMergeSplitBlockNodes(
    from,
    to,
    state.doc,
    tr,
    state.schema,
    deleteAttrs,
    userColors,
    state.doc.slice(0, 0) as ExposedSlice
  )
  applyAndMergeMarks(
    deleteMap.map(from),
    deleteMap.map(to),
    state.doc,
    tr,
    state.schema,
    deleteAttrs,
    userColors
  )
  dispatch && dispatch(tr)
  return true
}

export const addTrackedAttributesToBlockNode = (): Command => (state, dispatch) => {
  const cursor = state.selection.head
  const blockNodePos = state.doc.resolve(cursor).start(1) - 1
  const tr = state.tr.setNodeMarkup(blockNodePos, undefined, {
    dataTracked: {
      id: uuidv4(),
      userID: '1',
      userName: 'John',
      operation: CHANGE_OPERATION.insert,
      status: CHANGE_STATUS.pending,
      time: Date.now(),
    },
  })
  dispatch && dispatch(tr)
  return true
}

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

export const setUser =
  (user: TrackedUser): Command =>
  (state, dispatch) => {
    dispatch && dispatch(setAction(state.tr, TrackChangesAction.setUser, user))
    return true
  }

export const toggleShownStatuses =
  (statuses: CHANGE_STATUS[]): Command =>
  (state, dispatch) => {
    dispatch && dispatch(setAction(state.tr, TrackChangesAction.toggleShownStatuses, statuses))
    return true
  }

export const applyAndRemoveChanges = (): Command => (state, dispatch) => {
  dispatch && dispatch(setAction(state.tr, TrackChangesAction.applyAndRemoveChanges, true))
  return true
}

export const refreshChanges = (): Command => (state, dispatch) => {
  dispatch && dispatch(setAction(state.tr, TrackChangesAction.updateChanges, []))
  return true
}

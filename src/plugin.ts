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
import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import type { EditorProps, EditorView } from 'prosemirror-view'

import { getAction, setAction, TrackChangesAction } from './actions'
import { ChangeSet } from './ChangeSet'
import { log, enableDebug } from './utils/logger'
import { applyAcceptedRejectedChanges } from './track/applyChanges'
import { findChanges } from './track/findChanges'
import { fixInconsistentChanges } from './track/fixInconsistentChanges'
import { trackTransaction } from './track/trackTransaction'
import { updateChangeAttrs } from './track/updateChangeAttrs'
import { TrackChangesOptions, TrackChangesState, TrackChangesStatus } from './types/track'

export const trackChangesPluginKey = new PluginKey<TrackChangesState>('track-changes')

/**
 * The ProseMirror plugin needed to enable track-changes.
 *
 * Accepts an empty options object as an argument but note that this uses 'anonymous:Anonymous' as the default userID.
 * @param opts
 */
export const trackChangesPlugin = (
  opts: TrackChangesOptions = { userID: 'anonymous:Anonymous' }
) => {
  const { userID, debug, skipTrsWithMetas = [] } = opts
  let editorView: EditorView | undefined
  if (debug) {
    enableDebug(true)
  }

  return new Plugin<TrackChangesState>({
    key: trackChangesPluginKey,
    props: {
      editable(state) {
        return trackChangesPluginKey.getState(state)?.status !== TrackChangesStatus.viewSnapshots
      },
    } as EditorProps,
    state: {
      init(_config, state) {
        return {
          status: TrackChangesStatus.enabled,
          userID,
          changeSet: findChanges(state),
        }
      },

      apply(tr, pluginState, _oldState, newState): TrackChangesState {
        const setUserID = getAction(tr, TrackChangesAction.setUserID)
        const setStatus = getAction(tr, TrackChangesAction.setPluginStatus)
        if (setUserID) {
          return { ...pluginState, userID: setUserID }
        } else if (setStatus) {
          return {
            ...pluginState,
            status: setStatus,
            changeSet: findChanges(newState),
          }
        } else if (pluginState.status === TrackChangesStatus.disabled) {
          return { ...pluginState, changeSet: new ChangeSet() }
        }
        let { changeSet, ...rest } = pluginState
        const updatedChangeIds = getAction(tr, TrackChangesAction.updateChanges)
        if (updatedChangeIds || getAction(tr, TrackChangesAction.refreshChanges)) {
          changeSet = findChanges(newState)
        }
        return {
          changeSet,
          ...rest,
        }
      },
    },
    view(p) {
      editorView = p
      return {
        update: undefined,
        destroy: undefined,
      }
    },
    appendTransaction(trs, oldState, newState) {
      const pluginState = trackChangesPluginKey.getState(newState)
      if (
        !pluginState ||
        pluginState.status === TrackChangesStatus.disabled ||
        !editorView?.editable
      ) {
        return null
      }
      const { userID, changeSet } = pluginState
      let createdTr = newState.tr,
        docChanged = false
      log.info('TRS', trs)
      trs.forEach((tr) => {
        const wasAppended = tr.getMeta('appendedTransaction') as Transaction | undefined
        const skipMetaUsed = skipTrsWithMetas.some((m) => tr.getMeta(m) || wasAppended?.getMeta(m))
        const skipTrackUsed =
          getAction(tr, TrackChangesAction.skipTrack) ||
          (wasAppended && getAction(wasAppended, TrackChangesAction.skipTrack))
        if (tr.docChanged && !skipMetaUsed && !skipTrackUsed && !tr.getMeta('history$')) {
          createdTr = trackTransaction(tr, oldState, createdTr, userID)
        }
        docChanged = docChanged || tr.docChanged
        const setChangeStatuses = getAction(tr, TrackChangesAction.setChangeStatuses)
        if (setChangeStatuses) {
          const { status, ids } = setChangeStatuses
          ids.forEach((changeId: string) => {
            const change = changeSet?.get(changeId)
            if (change) {
              createdTr = updateChangeAttrs(createdTr, change, { status }, oldState.schema)
              setAction(createdTr, TrackChangesAction.updateChanges, [change.id])
            }
          })
        } else if (getAction(tr, TrackChangesAction.applyAndRemoveChanges)) {
          const mapping = applyAcceptedRejectedChanges(
            createdTr,
            oldState.schema,
            changeSet.nodeChanges
          )
          applyAcceptedRejectedChanges(createdTr, oldState.schema, changeSet.textChanges, mapping)
          setAction(createdTr, TrackChangesAction.refreshChanges, true)
        }
      })
      const changed =
        pluginState.changeSet.hasInconsistentData &&
        fixInconsistentChanges(pluginState.changeSet, userID, createdTr, oldState.schema)
      if (changed) {
        log.warn('had to fix inconsistent changes in', createdTr)
      }
      if (docChanged || createdTr.docChanged || changed) {
        createdTr.setMeta('origin', trackChangesPluginKey)
        return setAction(createdTr, TrackChangesAction.refreshChanges, true)
      }
      return null
    },
  })
}

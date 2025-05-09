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
import { Plugin, PluginKey, Transaction } from 'prosemirror-state'
import type { EditorProps, EditorView } from 'prosemirror-view'

import { getAction, hasAction, setAction, TrackChangesAction } from './actions'
import { findChanges } from './changes/findChanges'
import { fixInconsistentChanges } from './changes/fixInconsistentChanges'
import { updateChangesStatus } from './changes/updateChangesStatus'
import { ChangeSet } from './ChangeSet'
import { trackTransaction } from './steps/trackTransaction'
import { TrackChangesOptions, TrackChangesState, TrackChangesStatus } from './types/track'
import { enableDebug, log } from './utils/logger'
import { trFromHistory } from './utils/track-utils'

export const trackChangesPluginKey = new PluginKey<TrackChangesState>('track-changes')

/**
 * The ProseMirror plugin needed to enable track-changes.
 *
 * Accepts an empty options object as an argument but note that this uses 'anonymous:Anonymous' as the default userID.
 * @param opts
 */
export const trackChangesPlugin = (
  opts: TrackChangesOptions = { userID: 'anonymous:Anonymous', initialStatus: TrackChangesStatus.enabled }
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
          status: opts.initialStatus || TrackChangesStatus.enabled,
          userID,
          changeSet: findChanges(state),
        }
      },

      apply(tr, pluginState, _oldState, newState): TrackChangesState {
        if (!tr.docChanged && !hasAction(tr)) {
          return pluginState
        }

        const setUserID = getAction(tr, TrackChangesAction.setUserID)
        const setStatus = getAction(tr, TrackChangesAction.setPluginStatus)
        if (setUserID) {
          return { ...pluginState, userID: setUserID }
        } else if (setStatus) {
          return {
            ...pluginState,
            status: setStatus,
            changeSet: setStatus === TrackChangesStatus.disabled ? new ChangeSet() : findChanges(newState),
          }
        } else if (pluginState.status === TrackChangesStatus.disabled) {
          return { ...pluginState, changeSet: new ChangeSet() }
        }
        let { changeSet, ...rest } = pluginState

        if (getAction(tr, TrackChangesAction.refreshChanges) || trFromHistory(tr)) {
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
      if (!pluginState || pluginState.status === TrackChangesStatus.disabled || !editorView?.editable) {
        return null
      }
      const { userID, changeSet } = pluginState
      let createdTr: Transaction = newState.tr,
        docChanged = false
      log.info('TRS', trs)

      trs.forEach((tr) => {
        const wasAppended = tr.getMeta('appendedTransaction') as Transaction | undefined
        const skipMetaUsed = skipTrsWithMetas.some((m) => tr.getMeta(m) || wasAppended?.getMeta(m))

        // track changes allows free reign for client sync, because, if the changes was supposed to be tracked it should've been done on the respective client.
        const collabRebased = tr.getMeta('rebased')
        if (collabRebased !== undefined) {
          setAction(createdTr, TrackChangesAction.refreshChanges, true)
          docChanged = true
          return
        }
        const setChangeStatuses = getAction(tr, TrackChangesAction.setChangeStatuses)

        const skipTrackUsed =
          getAction(tr, TrackChangesAction.skipTrack) ||
          (wasAppended && getAction(wasAppended, TrackChangesAction.skipTrack))

        if (
          !setChangeStatuses &&
          tr.docChanged &&
          !skipMetaUsed &&
          !skipTrackUsed &&
          !trFromHistory(tr) &&
          !(wasAppended && tr.getMeta('origin') === 'paragraphs')
        ) {
          createdTr = trackTransaction(tr, oldState, createdTr, userID)
        }
        docChanged = docChanged || tr.docChanged

        if (setChangeStatuses) {
          const { status, ids } = setChangeStatuses

          updateChangesStatus(createdTr, changeSet, ids, status, userID, oldState)
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

/*!
 * © 2022 Atypon Systems LLC
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
import { wrapIn } from 'prosemirror-commands'
// import {lift, joinUp, selectParentNode, wrapIn, setBlockType} from "prosemirror-commands"
import { exampleSetup } from 'prosemirror-example-setup'
import { Mark, Node as PMNode, NodeRange, NodeType, Schema, Slice } from 'prosemirror-model'
import { EditorState, Plugin, TextSelection, Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { findWrapping } from 'prosemirror-transform'

import { ChangeSet, CHANGE_STATUS, trackChangesPluginKey, trackCommands } from '../../src'
import * as cmds from './commands'

export class ProsemirrorTestChain {
  view: EditorView

  constructor(view: EditorView) {
    this.view = view
  }

  trackState() {
    const trackState = trackChangesPluginKey.getState(this.view.state)
    if (!trackState) {
      return undefined
    }
    return trackState
  }

  setChangeStatuses(status = CHANGE_STATUS.accepted, changeIds?: string[]) {
    const trackState = this.trackState()
    if (trackState) {
      const ids = changeIds ?? ChangeSet.flattenTreeToIds(trackState.changeSet.pending)
      this.cmd(trackCommands.setChangeStatuses(status, ids))
    }
    return this
  }

  // TODO doesnt replace old trackChanges plugin
  reconfigurePlugins(plugins: Plugin[]) {
    const state = this.view.state.reconfigure({
      plugins: exampleSetup({ schema: this.view.state.schema }).concat(plugins),
    })
    this.view.setProps({
      state,
    })
    this.view.updateState(state)
    return this
  }

  replaceDoc(json: Record<string, any>) {
    const node = this.view.state.schema.nodeFromJSON(json)
    this.cmd(cmds.replace(node))
    return this
  }

  cmd(cmd: (state: EditorState, dispatch: (tr: Transaction) => void, view?: EditorView) => void) {
    cmd(this.view.state, this.view.dispatch, this.view)
    return this
  }

  insertText(text: string) {
    this.cmd(cmds.insertText(text))
    return this
  }

  insertMark(mark: Mark, start?: number, end?: number) {
    this.cmd((state, dispatch) => {
      const tr = state.tr
      const { from, to } = state.selection
      tr.addMark(start ?? from, end ?? to, mark)
      dispatch && dispatch(tr)
      return true
    })
    return this
  }

  insertNode(node: PMNode | null | undefined, pos?: number) {
    if (!node) {
      throw Error('No PMNode provided for insertNode!')
    }
    const { selection, tr } = this.view.state
    tr.insert(pos ?? selection.head, node)
    this.view.dispatch(tr)
    return this
  }

  paste(slice: Slice, start?: number, end?: number) {
    const {
      selection: { from, to },
      tr,
    } = this.view.state
    this.view.dispatch(
      tr
        .replace(start ?? from, end ?? to, slice)
        .setMeta('paste', true)
        .setMeta('uiEvent', 'paste')
    )
    return this
  }

  /**
   * Simulates backspace by deleting content at cursor but isn't really a backspace
   *
   * The .delete command behaves the same as backspace except when the cursor is at the start of the block
   * node. In that case, ProseMirror would normally trigger a .liftNode which is currently done as a separate
   * command.
   * @param times
   * @returns
   */
  backspace(times = 1) {
    const { selection, tr } = this.view.state
    const { from, empty } = selection
    if (empty) {
      tr.delete(from - times, from)
    } else {
      tr.deleteSelection()
      if (times > 1) {
        tr.delete(from - times, from)
      }
    }
    this.view.dispatch(tr)
    return this
  }

  delete(start?: number, end?: number) {
    this.cmd(cmds.deleteBetween(start ?? 0, end ?? this.view.state.doc.nodeSize - 2))
    return this
  }

  moveCursor(moved: 'start' | 'end' | number) {
    const { from } = this.view.state.selection
    if (moved === 'start') {
      this.view.dispatch(
        this.view.state.tr.setSelection(TextSelection.atStart(this.view.state.doc))
      )
    } else if (moved === 'end') {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.atEnd(this.view.state.doc)))
    } else {
      this.cmd(cmds.selectText(from + moved))
    }
    return this
  }

  selectText(start: number, end?: number) {
    this.cmd(cmds.selectText(start, end))
    return this
  }

  setNodeMarkup(pos: number, attrs?: Record<string, any>) {
    this.cmd((state, dispatch) => {
      dispatch(state.tr.setNodeMarkup(pos, undefined, attrs))
    })
    return this
  }

  wrapIn(nodeType: NodeType, attrs?: { [key: string]: any }) {
    this.cmd(wrapIn(nodeType, attrs))
    return this
  }

  wrapInInline(nodeType: NodeType, attrs?: { [key: string]: any }) {
    this.cmd((state, dispatch) => {
      const range = new NodeRange(
          state.selection.$from,
          state.selection.$to,
          state.selection.$from.depth
        ),
        wrapping = findWrapping(range, nodeType, attrs)
      wrapping && dispatch(state.tr.wrap(range, wrapping))
    })
    return this
  }

  liftnode(pos: number) {
    this.cmd(cmds.liftNode(pos))
    return this
  }

  toJSON() {
    return this.view.state.toJSON()
  }
}

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
import { Command } from 'prosemirror-commands'
import { exampleSetup } from 'prosemirror-example-setup'
import { Mark, Node as PMNode, Schema } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

import { trackChangesPluginKey } from '../../src'
import * as cmds from './commands'

export class ProsemirrorTestChain<S extends Schema> {
  view: EditorView<S>

  constructor(view: EditorView<S>) {
    this.view = view
  }

  trackState() {
    const trackState = trackChangesPluginKey.getState(this.view.state)
    if (!trackState) {
      return undefined
    }
    return trackState
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

  cmd(cmd: Command) {
    cmd(this.view.state, this.view.dispatch)
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

  backspace(times = 1) {
    this.cmd(cmds.backspace(times))
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

  toJSON() {
    return this.view.state.toJSON()
  }
}

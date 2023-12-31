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
import { Command, TextSelection } from 'prosemirror-state'
import { liftTarget } from 'prosemirror-transform'

export const insertText =
  (text: string, pos?: number): Command =>
  (state, dispatch) => {
    const tr = state.tr
    tr.insertText(text, pos)
    dispatch && dispatch(tr)
    return true
  }

export const addMark =
  (text: string, pos?: number): Command =>
  (state, dispatch) => {
    const tr = state.tr
    tr.insertText(text, pos)
    dispatch && dispatch(tr)
    return true
  }

export const deleteBetween =
  (start?: number, end?: number): Command =>
  (state, dispatch) => {
    const tr = state.tr
    const { from, to } = state.selection
    tr.delete(start ?? from, end ?? to)
    dispatch && dispatch(tr)
    return true
  }

export const backspace =
  (times = 1): Command =>
  (state, dispatch) => {
    const { selection, tr } = state
    const { from, empty } = selection

    if (empty) {
      tr.delete(from - times, from)
    } else {
      tr.deleteSelection()
      if (times > 1) {
        tr.delete(from - (times - 1), from)
      }
    }

    dispatch && dispatch(tr)
    return true
  }

export const replace =
  (content: Fragment | PMNode | PMNode[], start?: number, end?: number): Command =>
  (state, dispatch) => {
    const { tr } = state
    tr.replaceWith(start ?? 0, end ?? state.doc.nodeSize - 2, content)
    dispatch && dispatch(tr)
    return true
  }

export const liftNode =
  (pos: number): Command =>
  (state, dispatch) => {
    const startPos = state.doc.resolve(pos)
    const node = state.doc.nodeAt(pos)
    if (!node) {
      return false
    }
    const range = startPos.blockRange(state.doc.resolve(startPos.pos + node.nodeSize))
    const targetDepth = range ? Number(liftTarget(range)) : NaN
    if (range && !Number.isNaN(targetDepth)) {
      dispatch && dispatch(state.tr.lift(range, targetDepth))
      return true
    }
    return false
  }

export const selectText =
  (start: number, end?: number): Command =>
  (state, dispatch) => {
    const { tr } = state
    tr.setSelection(TextSelection.create(state.doc, start, end))
    dispatch && dispatch(tr)
    return true
  }

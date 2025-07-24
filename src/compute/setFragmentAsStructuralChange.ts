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
import {Attrs, Fragment, NodeType} from 'prosemirror-model'
import { EditorState, Transaction } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'

import { StructureChangesShadow } from '../changes/structureChangesShadow'
import { StructureAttrs } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import * as trackUtils from '../utils/track-utils'
import { updateBlockNodesAttrs } from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from './nodeHelpers'

/**
 * add reference change to parent node
 */
function setReferenceChange(
  oldState: EditorState,
  newTr: Transaction,
  step: ReplaceStep,
  action: StructureAttrs['action'],
  attrs: NewEmptyAttrs,
  moveNodeId: string
) {
  const offset =
    action === 'convert-to-paragraph' || action === 'indent-section' || action === 'unindent-section' ? 2 : 1
  const depth = oldState.selection.$from.depth - offset
  const parentPos = oldState.selection.$from.before(depth)
  const parent = newTr.doc.nodeAt(parentPos)

  let content = step.slice.content

  if (parent && parent.type.spec.attrs?.dataTracked) {
    const referenceChange = addTrackIdIfDoesntExist(trackUtils.createNewReferenceAttrs(attrs, moveNodeId))
    const dataTracked = [...(getBlockInlineTrackedData(parent) || []), referenceChange]
    if (step.from <= parentPos) {
      content = updateBlockNodesAttrs(content, (attrs, node, pos) =>
        parentPos - step.from === pos ? { ...attrs, dataTracked } : attrs
      )
    } else {
      newTr.setNodeMarkup(parentPos, undefined, { ...parent.attrs, dataTracked })
    }
  } else {
    if (parent && parent.attrs.id) {
      ;(attrs as Partial<StructureAttrs>).parentId = parent.attrs.id
    }
  }

  const index = oldState.selection.$from.index(depth)

  return [content, index] as [Fragment, number]
}

/**
 *  This function track structural changes by looking in the ReplaceStep slice where the change start using `findDiffStart`
 *  and add dataTracked for the affected node. also will create reference change to at the parent node to the change or
 *  if it's parent a root nodes(body,abstract..) will use id from attr as a reference to that node
 */
export function setFragmentAsStructuralChange(
  step: ReplaceStep,
  oldState: EditorState,
  newTr: Transaction,
  tr: Transaction,
  attrs: NewEmptyAttrs
) {
  // that ID will be the connection between the structural changes and shadow node
  const moveNodeId = uuidv4()
  const action = tr.getMeta('structure-change-action') as StructureAttrs['action']
  const parentType = tr.getMeta('shadow-parent-type') as NodeType
  const containerType = tr.getMeta('shadow-container-type') as NodeType
  const [stepContent, index] = setReferenceChange(oldState, newTr, step, action, attrs, moveNodeId)
  const structureChange = trackUtils.createNewStructureAttrs({ ...attrs, moveNodeId, action, index })
  const updatedNodes = new Map<number, Attrs>()

  const shadow = new StructureChangesShadow(newTr)
  shadow.init(parentType, containerType, attrs)

  const replaceContent = newTr.doc.slice(step.from, step.to).content
  const differentPos = replaceContent.findDiffStart(step.slice.content) || 0

  stepContent.nodesBetween(differentPos, stepContent.size, (node, pos) => {
    if (pos < differentPos) {
      return
    }
    const dataTracked = [addTrackIdIfDoesntExist(structureChange), ...(getBlockInlineTrackedData(node) || [])]
    updatedNodes.set(pos, { ...node.attrs, dataTracked })
    return false
  })

  shadow.commit(
    moveNodeId,
    oldState.schema.nodes.section,
    tr.doc.slice(step.from + differentPos, step.to).content,
    step.from + differentPos,
    step.to
  )

  return updateBlockNodesAttrs(stepContent, (attrs, node, pos) =>
    updatedNodes.has(pos) ? { ...updatedNodes.get(pos) } : attrs
  )
}

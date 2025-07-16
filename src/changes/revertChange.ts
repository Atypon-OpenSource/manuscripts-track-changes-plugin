/*!
 * © 2024 Atypon Systems LLC
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
import { ManuscriptNode } from '@manuscripts/transform'
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { liftTarget, Mapping, ReplaceAroundStep } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { getDataTrackedOfConvertedNode } from '../compute/setFragmentAsStructuralChange'
import {
  CHANGE_OPERATION,
  IncompleteChange,
  NodeChange,
  StructureAttrs,
  TrackedAttrs,
  TrackedChange,
} from '../types/change'
import { updateBlockNodesAttrs } from '../utils/track-utils'
import { getUpdatedDataTracked } from './applyChanges'
import { findChanges } from './findChanges'

/**
 *  move split-ed content back to the original node. and will update original node dataTracked in these cases:
 *  * the split-ed node has another split will move split_source attr to the original node.
 *  * remove deleted track attr from original node
 */
export function revertSplitNodeChange(tr: Transaction, change: IncompleteChange, changeSet: ChangeSet) {
  const sourceChange = changeSet.changes.find(
    (c) => c.dataTracked.operation === 'reference' && c.dataTracked.referenceId === change.id
  )!

  const node = tr.doc.nodeAt(tr.mapping.map(change.from)) as ManuscriptNode

  tr.delete(tr.mapping.map(change.from), tr.mapping.map(change.to))
  tr.replaceWith(tr.mapping.map(sourceChange.to - 1), tr.mapping.map(sourceChange.to), node.content)

  if ((change as NodeChange).node.type.name === 'list_item') {
    tr.join(sourceChange.to - 1)
  }

  // in case node split has another split will move source to the above node
  const childSource = changeSet.changes.find(
    (c) => c.from === change.from && c.dataTracked.operation === 'reference'
  )
  if (childSource) {
    const node = tr.doc.nodeAt(tr.mapping.map(sourceChange.from)) as ManuscriptNode
    const data = getBlockInlineTrackedData(node) || []
    const dataTracked = data.map((c) => (c.operation === 'reference' ? childSource.dataTracked : c))
    tr.setNodeMarkup(tr.mapping.map(sourceChange.from), undefined, { ...node.attrs, dataTracked }, node.marks)
  }

  // This will remove delete attr from source node, to avoid conflict with the moved content
  const deleteChange = changeSet.changes.find(
    (c) => c.dataTracked.operation == 'delete' && c.from === sourceChange.from
  )
  if (deleteChange) {
    const node = tr.doc.nodeAt(tr.mapping.map(deleteChange.from)) as ManuscriptNode
    tr.setNodeMarkup(
      tr.mapping.map(deleteChange.from),
      undefined,
      getUpdatedDataTracked(node.attrs.dataTracked, deleteChange.id)
    )
  }
}

export function revertWrapNodeChange(tr: Transaction, change: IncompleteChange, deleteMap: Mapping) {
  const from = tr.mapping.map(change.from)
  const to = tr.mapping.map(change.to)
  const node = tr.doc.nodeAt(from)
  // we use ReplaceAroundStep for inline node, as lift will not work with inline node and will help to get right mapping
  if (node?.isInline) {
    // gapping will be narrow to exclude the wrapped node
    tr.step(new ReplaceAroundStep(from, to, from + 1, to - 1, Slice.empty, 0))
    deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
  } else {
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const $fromPos = tr.doc.resolve(tr.mapping.map(pos))
      const $toPos = tr.doc.resolve(tr.mapping.map(pos + node.nodeSize - 1))
      const nodeRange = $fromPos.blockRange($toPos)
      if (!nodeRange) {
        return
      }

      const targetLiftDepth = liftTarget(nodeRange)
      if (targetLiftDepth || targetLiftDepth === 0) {
        tr.lift(nodeRange, targetLiftDepth)
        deleteMap.appendMap(tr.steps[tr.steps.length - 1].getMap())
      }
    })
  }
}

export function revertStructureNodeChange(
  tr: Transaction,
  change: NodeChange & { dataTracked: StructureAttrs },
  changeSet: ChangeSet,
  remainingChangesId: string[]
) {
  const schema = tr.doc.type.schema

  /** Return converted section_title as paragraph node and remaining section content as sibling to the paragraph
   *  From: <sec><title>1</title><p>2</p></sec>
   *  To:  <p>1</p><p>2</p>
   * */
  if (change.dataTracked.action === 'convert-to-section') {
    const updatedChange = (changeSet.get(change.id) || change) as NodeChange
    tr.delete(updatedChange.from, updatedChange.to)

    const section = cleanChangeFromFragment([updatedChange.node], change).firstChild || updatedChange.node
    const sectionTitle = section.child(0)
    const { dataTracked } = getDataTrackedOfConvertedNode(section)
    const content = Fragment.from(
      schema.nodes.paragraph.create({ dataTracked }, sectionTitle.content)
    ).append(section.slice(sectionTitle.nodeSize).content)

    updateRemainingChangesId(section, content.child(0), remainingChangesId)

    const insertPo = getStructureChangePosition(findChanges(tr.doc), change, tr.doc)
    tr.insert(insertPo, content)
  }

  /** Rebuild section as first change will be content of section_title and remaining changes will be section content
   *  From: <p>1</p><p>2</p>
   *  To:  <sec><title>1</title><p>2</p></sec>
   * */
  if (change.dataTracked.action === 'convert-to-paragraph') {
    const changes = changeSet.changes.filter(
      (c) => c.dataTracked.moveNodeId === change.dataTracked.moveNodeId
    ) as NodeChange[]
    tr.delete(changes[0].from, changes[changes.length - 1].to)

    const changesContent = cleanChangeFromFragment(
      changes.map((c) => c.node),
      change
    )
    const { dataTracked, secDataTracked } = getDataTrackedOfConvertedNode(changesContent.content[0])
    const sectionTitle = schema.nodes.section_title.create(
      { ...changesContent.firstChild?.attrs, dataTracked },
      changesContent.firstChild?.content
    )
    const section = schema.nodes.section.create(
      { dataTracked: secDataTracked },
      Fragment.from(sectionTitle).append(Fragment.from(changesContent.content.slice(1)))
    )

    updateRemainingChangesId(changesContent.child(0), section, remainingChangesId)

    const insertPo = getStructureChangePosition(findChanges(tr.doc), change, tr.doc)
    tr.insert(insertPo, section)
  }

  const reference = changeSet.changes.find(
    (c) =>
      c.dataTracked.operation === CHANGE_OPERATION.reference &&
      c.dataTracked.referenceId === change.dataTracked.moveNodeId
  )
  if (reference) {
    const index = remainingChangesId.findIndex((id) => id === reference.id)
    if (index === -1) {
      remainingChangesId.push(reference.id)
    }
  }
}

/**
 *  this function return position of the place we need to return structure change back.
 *  will build this position by getting parent of that place and child index
 */
const getStructureChangePosition = (
  changeSet: ChangeSet,
  change: TrackedChange & { dataTracked: StructureAttrs },
  doc: PMNode
) => {
  let parentPos = changeSet.changes.find(
    (c) =>
      c.dataTracked.operation === CHANGE_OPERATION.reference &&
      c.dataTracked.referenceId === change.dataTracked.moveNodeId
  )?.from

  if (!parentPos && change.dataTracked.parentId) {
    parentPos = getNodePos(doc, (node) => node.attrs.id === change.dataTracked.parentId)
  }

  let insertPos

  if (parentPos) {
    const $pos = doc.resolve(parentPos + 1)
    $pos.node().forEach((node, pos, index) => {
      if (change.dataTracked.index === index) {
        insertPos = $pos.pos + pos
      }
    })
    if (!insertPos) {
      insertPos = $pos.pos + $pos.node().content.size
    }
  } else {
    insertPos = change.from
  }
  return insertPos
}

const getNodePos = (doc: PMNode, predicate: (node: PMNode) => boolean) => {
  let to: number | undefined
  doc.descendants((node, pos) => {
    if (predicate(node)) {
      to = pos
      return false
    }

    if (to) {
      return false
    }
  })

  return to
}

const cleanChangeFromFragment = (
  changesContent: PMNode[],
  change: NodeChange & { dataTracked: StructureAttrs }
) => {
  return updateBlockNodesAttrs(Fragment.from(changesContent), (attrs, node) => ({
    ...attrs,
    dataTracked: (getBlockInlineTrackedData(node) || []).filter(
      (c) =>
        c.moveNodeId !== change.dataTracked.moveNodeId &&
        !(c.operation === CHANGE_OPERATION.reference && c.referenceId === change.dataTracked.moveNodeId)
    ),
  }))
}

const updateRemainingChangesId = (node: PMNode, newNode: PMNode, remainingChangesId: string[]) => {
  const oldChange = (getBlockInlineTrackedData(node) || []).find(
    (c) => c.operation === CHANGE_OPERATION.insert
  )
  const newChange = (getBlockInlineTrackedData(newNode) || []).find(
    (c) => c.operation === CHANGE_OPERATION.insert
  )
  const index = remainingChangesId.findIndex((id) => id === oldChange?.id)
  if (newChange?.id && index !== -1) {
    remainingChangesId[index] = newChange.id
  }
}

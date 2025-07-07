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
  change: TrackedChange & { dataTracked: StructureAttrs },
  changeSet: ChangeSet,
  remainingChangesId: string[]
) {
  const schema = tr.doc.type.schema

  /** Return converted section_title as paragraph node and remaining section content as sibling to the paragraph
   *  From: <sec><title>1</title><p>2</p></sec>
   *  To:  <p>1</p><p>2</p>
   *  and will cleanup reference related to paragraph
   * */
  if (change.dataTracked.action === 'convert-to-section') {
    const section = getUpdatedChangesContent(tr.doc, (c) => c.id === change.id)[0]
    const [changePos, changeNode] = getChangePosition(tr.doc, change)
    tr.delete(changePos, changePos + (changeNode?.nodeSize || 0))

    let insertPos = changePos
    const refChange = changeSet.changes.find(
      (c) =>
        c.dataTracked.operation === CHANGE_OPERATION.reference &&
        c.dataTracked.referenceId === change.dataTracked.moveNodeId
    )
    if (refChange) {
      const [refPos, refNode] = getChangePosition(tr.doc, refChange)
      insertPos = refPos + (refNode?.nodeSize || 0)
      if (refNode) {
        const dataTracked = (getBlockInlineTrackedData(refNode) || []).filter((c) => c.id !== refChange.id)
        // clean-up reference from here as it could be moved from other change
        tr.setNodeMarkup(refPos, undefined, { ...refNode.attrs, dataTracked })
      }
    }

    const sectionTitle = section.firstChild || schema.nodes.section_title.create()
    let { dataTracked } = getDataTrackedOfConvertedNode(section)
    dataTracked = dataTracked.filter(
      (c) =>
        !(
          c.id === change.id ||
          (c.operation === CHANGE_OPERATION.reference && c.referenceId === change.dataTracked.moveNodeId)
        )
    )
    const content = Fragment.from(
      schema.nodes.paragraph.create({ dataTracked }, sectionTitle.content)
    ).append(section.slice(sectionTitle.nodeSize).content)

    tr.insert(insertPos, content)
  }

  /** Rebuild section as first change will be content of section_title and remaining changes will be section content
   *  From: <p>1</p><p>2</p>
   *  To:  <sec><title>1</title><p>2</p></sec>
   * */
  if (change.dataTracked.action === 'convert-to-paragraph') {
    const changesContent = getUpdatedChangesContent(
      tr.doc,
      (c) => c.moveNodeId === change.dataTracked.moveNodeId
    )
    const changes = changeSet.changes.filter(
      (c) => c.dataTracked.moveNodeId === change.dataTracked.moveNodeId
    )
    let [from] = getChangePosition(tr.doc, changes[0])
    let [to, toNode] = getChangePosition(tr.doc, changes[changes.length - 1])
    tr.delete(from, to + (toNode?.nodeSize || 0))

    const $pos = tr.doc.resolve(from)
    let pos = from
    if (change.dataTracked.sectionLevel) {
      pos = $pos.end(change.dataTracked.sectionLevel) + 1
    } else if (change.dataTracked.isThereSectionBefore) {
      pos = $pos.end($pos.depth) + 1
    }

    const cleanContent = updateBlockNodesAttrs(Fragment.from(changesContent), (attrs, node) => ({
      ...attrs,
      dataTracked: (getBlockInlineTrackedData(node) || []).filter(
        (c) => c.moveNodeId !== change.dataTracked.moveNodeId
      ),
    }))
    const { dataTracked, secDataTracked } = getDataTrackedOfConvertedNode(cleanContent.content[0])
    const sectionTitle = schema.nodes.section_title.create(
      { ...cleanContent.firstChild?.attrs, dataTracked },
      cleanContent.firstChild?.content
    )
    const section = schema.nodes.section.create(
      {
        dataTracked: secDataTracked.filter((c) => c.operation !== CHANGE_OPERATION.delete),
      },
      Fragment.from(sectionTitle).append(Fragment.from(cleanContent.content.slice(1)))
    )

    const sectionInsert = secDataTracked.find((c) => c.operation === CHANGE_OPERATION.insert) as TrackedAttrs
    if (sectionInsert) {
      const insertId = dataTracked.find((c) => c.operation === CHANGE_OPERATION.insert)
      const index = remainingChangesId.findIndex((id) => id === insertId?.id)
      if (index !== -1) {
        // replace paragraph change id with that have been converted to section change
        remainingChangesId[index] = sectionInsert.id
      }
    }
    tr.insert(pos, section)
  }
}

export const getUpdatedChangesContent = (
  doc: PMNode,
  predicate: (change: Partial<TrackedAttrs>) => boolean
) => {
  const content: PMNode[] = []
  doc.descendants((node) => {
    if (node.attrs.dataTracked) {
      const dataTracked = getBlockInlineTrackedData(node)?.find(predicate)
      dataTracked && content.push(node)
    }
  })
  return content
}

const getChangePosition = (doc: PMNode, referenceChange: TrackedChange) => {
  let to: [number, PMNode] | undefined
  doc.descendants((node, pos) => {
    if (node.attrs.dataTracked) {
      const dataTracked = getBlockInlineTrackedData(node)?.find((c) => c.id === referenceChange.id)
      if (dataTracked) {
        to = [pos, node]
        return false
      }
    }

    if (to) {
      return false
    }
  })

  return to || [referenceChange.to, undefined]
}

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
import { liftTarget, Mapping, ReplaceAroundStep, StepMap } from 'prosemirror-transform'

import { ChangeSet } from '../ChangeSet'
import { getBlockInlineTrackedData } from '../compute/nodeHelpers'
import {
  CHANGE_OPERATION,
  IncompleteChange,
  NodeChange,
  StructureAttrs,
  TrackedAttrs,
  TrackedChange,
} from '../types/change'
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
  deleteMap: Mapping
) {
  const schema = tr.doc.type.schema

  /** Return converted section_title as paragraph node and remaining section content as sibling to the paragraph
   *  From: <sec><title>1</title><p>2</p></sec>
   *  To:  <p>1</p><p>2</p>
   *  and will cleanup reference related to paragraph
   * */
  if (change.dataTracked.action === 'convert-section') {
    const section = getUpdatedChangesContent(tr, (c) => c.id === change.id)[0]
    const [changePos, changeNode] = getChangePosition(tr, change)
    tr.delete(changePos, changePos + (changeNode?.nodeSize || 0))

    let insertPos = change.from

    const refChange = changeSet.changes.find(
      (c) =>
        c.dataTracked.operation === CHANGE_OPERATION.reference &&
        c.dataTracked.referenceId === change.dataTracked.moveNodeId
    )
    if (refChange) {
      const [refPos, refNode] = getChangePosition(tr, refChange)
      insertPos = refPos + (refNode?.nodeSize || 0)
      if (refNode) {
        const dataTracked = (getBlockInlineTrackedData(refNode) || []).filter((c) => c.id !== refChange.id)
        // clean-up reference from here is it could be moved from other change
        tr.setNodeMarkup(refPos, undefined, { ...refNode.attrs, dataTracked })
      }
    }

    const sectionTitle = section.firstChild || schema.nodes.section_title.create()
    const dataTracked = (getBlockInlineTrackedData(sectionTitle) || []).filter((c) => c.id !== change.id)
    const content = Fragment.from(
      schema.nodes.paragraph.create({ ...sectionTitle.attrs, dataTracked }, sectionTitle.content)
    ).append(section.slice(sectionTitle.nodeSize).content)

    tr.insert(insertPos, content)
    deleteMap.appendMap(new StepMap([changePos, 1, 0, changePos + content.size, 1, 0]))
  }

  /** Rebuild section as first change will be content of section_title and remaining changes will be section content
   *  From: <p>1</p><p>2</p>
   *  To:  <sec><title>1</title><p>2</p></sec>
   * */
  if (change.dataTracked.action === 'convert-paragraph') {
    const changesContent = getUpdatedChangesContent(tr, (c) => c.moveNodeId === change.dataTracked.moveNodeId)
    const changes = changeSet.changes.filter(
      (c) => c.dataTracked.moveNodeId === change.dataTracked.moveNodeId
    )
    let [from] = getChangePosition(tr, changes[0])
    let [to, toNode] = getChangePosition(tr, changes[changes.length - 1])
    tr.delete(from, to + (toNode?.nodeSize || 0))

    const $pos = tr.doc.resolve(from)
    let pos = from
    if (change.dataTracked.sectionLevel) {
      pos = $pos.end(change.dataTracked.sectionLevel) + 1
    } else if (change.dataTracked.isThereSectionBefore) {
      pos = $pos.end($pos.depth) + 1
    }

    const sectionContent = changesContent.slice(1).map((node) => {
      const dataTracked = (getBlockInlineTrackedData(node) || []).filter(
        (c) => c.moveNodeId !== change.dataTracked.moveNodeId
      )
      return node.type.create({ ...node.attrs, dataTracked }, node.content)
    })
    const dataTracked = ((changesContent[0] && getBlockInlineTrackedData(changesContent[0])) || []).filter(
      (c) => c.moveNodeId !== change.dataTracked.moveNodeId
    )
    const sectionTitle = schema.nodes.section_title.create(
      {
        // will move convert-paragraph change that was from previous changes, and will be set in the section
        dataTracked: dataTracked.filter(
          (c) => c.operation === CHANGE_OPERATION.structure && c.action !== 'convert-paragraph'
        ),
      },
      schema.text(changesContent[0].textContent)
    )
    tr.insert(
      pos,
      schema.nodes.section.create(
        {
          dataTracked: dataTracked.filter(
            (c) => c.operation === CHANGE_OPERATION.structure && c.action === 'convert-paragraph'
          ),
        },
        Fragment.from([sectionTitle, ...sectionContent])
      )
    )
    deleteMap.appendMap(new StepMap([from, 0, 1, to + (toNode?.nodeSize || 0), 0, 1]))
  }
}

const getUpdatedChangesContent = (tr: Transaction, predicate: (change: Partial<TrackedAttrs>) => boolean) => {
  const content: PMNode[] = []
  tr.doc.descendants((node) => {
    if (node.attrs.dataTracked) {
      const dataTracked = getBlockInlineTrackedData(node)?.find(predicate)
      dataTracked && content.push(node)
    }
  })
  return content
}

const getChangePosition = (tr: Transaction, referenceChange: TrackedChange) => {
  let to: [number, PMNode] | undefined
  tr.doc.descendants((node, pos) => {
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

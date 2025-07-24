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
import { Fragment, Node as PMNode, NodeType, ResolvedPos } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'

import { ChangeSet } from '../ChangeSet'
import { addTrackIdIfDoesntExist, getBlockInlineTrackedData } from '../compute/nodeHelpers'
import { CHANGE_OPERATION, TrackedChange } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import {createNewDeleteAttrs, updateBlockNodesAttrs} from '../utils/track-utils'

function getContainerPos(doc: PMNode, predicate: (node: PMNode) => boolean) {
  let pos = 0
  doc.descendants((node, offset) => {
    if (predicate(node)) {
      pos = offset + 1
      return false
    }
    if (pos) {
      return false
    }
  })
  return pos
}

interface Commit {
  id: string
  pos: number
  shadow: Fragment
  parentsId: Set<string>
  childrenId: Set<string>
}

/**
 * Build a shadow to structure changes in document, that will be similar to Version Control System in a very simple fashion
 * will create a container as deleted node, so it can be cleaned up.
 */
export class StructureChangesShadow {
  container: PMNode
  $pos: ResolvedPos
  tr: Transaction
  graph: DAGGraph

  constructor(tr: Transaction) {
    this.tr = tr
    this.$pos = tr.doc.resolve(
      getContainerPos(tr.doc, (node) => node.attrs.id === 'structure-changes-shadow')
    )
    this.container = this.$pos.node()
    this.graph = new DAGGraph(tr, this.$pos, this.container)
  }

  public init(type: NodeType, parentType: NodeType, attr: NewEmptyAttrs) {
    const pos = getContainerPos(this.tr.doc, (node) => node.type === parentType)
    const container = type.createAndFill({
        id: 'structure-changes-shadow',
        dataTracked: [addTrackIdIfDoesntExist(createNewDeleteAttrs({ ...attr, moveNodeId: 'shadow' }))],
      })
    if (!this.$pos.pos && container) {
      this.container = container
      const $pos = this.tr.doc.resolve(pos)
      this.tr.insert($pos.end(), this.container)
      this.$pos = this.tr.doc.resolve($pos.end() + 1)
    }
  }

  public commit(moveNodeId: string, type: NodeType, updatedContent: Fragment, from: number, to: number) {
    const delta = this.tr.doc.resolve(from).depth - this.tr.doc.resolve(to).depth
    const content = this.tr.doc.slice(from + delta, to - delta).content
    const parentCommits = this.getCommits(content)
    this.addChildCommit(parentCommits, moveNodeId)

    const lockContent = updateBlockNodesAttrs(content, (attrs) => ({...attrs, id: attrs.id + "|"}))
    const shadow = type.createAndFill({ id: moveNodeId }, lockContent)!
    this.tr.insert(this.$pos.end(), shadow)
  }

  private getCommits(content: Fragment) {
    const commits = new Set<string>()

    content.descendants((node) => {
      if (node.isBlock) {
        ;(getBlockInlineTrackedData(node) || [])
          .filter((c) => c.operation === CHANGE_OPERATION.structure)
          .map((c) => {
            c.moveNodeId && commits.add(c.moveNodeId)
          })
      }
    })
    return commits
  }

  // add child commit id to the related parent commit, so we can use it to build DAG graph
  private addChildCommit(parentCommits: Set<string>, childCommit: string) {
    this.container.forEach((node, offset, index) => {
      if (index === 0) {
        return
      }
      const ids = node.attrs.id.split('|') as string[]
      if (ids.find((id) => parentCommits.has(id))) {
        this.tr.setNodeMarkup(this.$pos.pos + offset, undefined, { id: `${node.attrs.id}|${childCommit}` })
      }
    })
  }

  revert(commitId: string) {
    const commit = this.graph.getCommit(commitId)
    this.graph.dropCommit(commit.id)
    return updateBlockNodesAttrs(commit.shadow, (attrs) => ({...attrs, id: attrs.id?.split("|")[0]}))
  }

  public static revert(changeSet: ChangeSet, change: TrackedChange, tr: Transaction) {
    const shadow = new StructureChangesShadow(tr)
    const commit = change.dataTracked.moveNodeId && shadow.graph.commits.get(change.dataTracked.moveNodeId)
    if (!commit) {
      throw Error('commit not found in document')
    }
    return shadow.revert(commit.id)
  }
}

class DAGGraph {
  commits: Map<string, Commit> = new Map<string, Commit>()
  tr: Transaction

  constructor(tr: Transaction, $pos: ResolvedPos, container: PMNode) {
    this.tr = tr
    $pos.pos > 0 &&
      container.forEach((node, offset) => {
        if (node.attrs.id) {
          const { id, children, parent } = this.getId(node)
          this.commits.set(id, {
            id,
            shadow: node.slice(2).content,
            childrenId: new Set(children),
            pos: $pos.pos + offset,
            parentsId: new Set(parent),
          })
        }
      })
  }

  getId(node: PMNode) {
    const [id, ...children] = node.attrs.id.split('|')
    const parent = Array.from(this.commits.values())
      .filter((commit) => commit.childrenId.has(id))
      .map((commit) => commit.id)
    return { id, children: children.reverse(), parent }
  }

  public dropCommit(id: string) {
    const commit = this.getCommit(id)

    /** remove child commit id from parent commit */
    Array.from(commit.parentsId.values()).map((parentId) => {
      const commit = this.getCommit(parentId)
      const childrenId = Array.from(commit.childrenId.values())
        .filter((c) => c !== id)
      this.tr.setNodeMarkup(commit.pos, undefined, { id: `${[parentId, ...childrenId].join('|')}` })
    })

    const node = this.tr.doc.nodeAt(commit.pos)
    this.tr.delete(commit.pos, commit.pos + (node?.nodeSize || 0))
  }

  getCommit(id: string): Commit {
    const commit = this.commits.get(id)
    if (!commit) {
      throw Error('commit not found in document')
    }
    return commit
  }
}

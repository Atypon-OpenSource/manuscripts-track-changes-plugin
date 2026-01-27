import { schema } from '@manuscripts/transform'
import { Attrs, Fragment, Mark, Node as ProsemirrorNode } from 'prosemirror-model'
import { CHANGE_OPERATION, TrackedAttrs } from '../types/change'
import { isShadowDelete } from '../tracking/steps-trackers/qualifiers'

export function isDeleted(node: ProsemirrorNode | Mark) {
  if (node.attrs.dataTracked) {
    const changes = node.attrs.dataTracked as TrackedAttrs[]
    return changes.some(({ operation }) => operation === 'delete')
  }
  return false
}

export function isPendingInsert(node: ProsemirrorNode) {
  if (node.attrs.dataTracked) {
    const changes = node.attrs.dataTracked as TrackedAttrs[]
    return changes.some(({ operation, status }) => operation === 'insert' && status == 'pending')
  }
  return false
}

export function isPending(node: ProsemirrorNode) {
  if (node.attrs.dataTracked) {
    const changes = node.attrs.dataTracked as TrackedAttrs[]
    return changes.some(({ status }) => status == 'pending')
  }
  return false
}

export function isPendingSetAttrs(node: ProsemirrorNode) {
  if (node.attrs.dataTracked) {
    const changes = node.attrs.dataTracked as TrackedAttrs[]
    return changes.some(({ operation, status }) => operation === 'set_attrs' && status == 'pending')
  }
  return false
}

export function getChangeClasses(dataTracked?: TrackedAttrs[]) {
  const classes: string[] = []

  if (dataTracked) {
    const changes = dataTracked as TrackedAttrs[]
    const operationClasses = new Map([
      ['insert', 'inserted'],
      ['delete', 'deleted'],
      ['set_attrs', 'set_attrs'],
    ])
    changes.forEach(({ operation, status }) => classes.push(operationClasses.get(operation) || '', status))
  }
  return classes
}

export function isTracked(node: ProsemirrorNode | Mark) {
  if (node.attrs.dataTracked) {
    const changes = node.attrs.dataTracked as TrackedAttrs[]
    return changes.some(
      ({ operation }) => operation === 'insert' || operation === 'delete' || operation === 'set_attrs'
    )
  }
  return false
}

export function isDeletedText(node: ProsemirrorNode) {
  if (node.type === schema.nodes.text && node.marks.length) {
    const deleteMark = node.marks.find((mark) => mark.type === schema.marks.tracked_delete)
    if (
      deleteMark &&
      deleteMark.attrs?.dataTracked?.status &&
      'pending' === deleteMark.attrs?.dataTracked?.status
    ) {
      return true
    }
  }
  return false
}

export function getActualTextContent(fragment: Fragment) {
  let finalContent = ''

  function getContent(fragment: Fragment) {
    fragment.forEach((node) => {
      if (node.type !== schema.nodes.text) {
        finalContent += getContent(node.content)
      }
      if (!isDeletedText(node)) {
        finalContent += node.textContent
      }
    })
  }

  getContent(fragment)
  return finalContent
}

export function sanitizeAttrsChange<T extends ProsemirrorNode>(
  newAttr: T['attrs'],
  currentAttrs: T['attrs']
) {
  return Object.keys(newAttr).reduce((acc, attr) => {
    const key = attr as keyof T['attrs']
    if (!currentAttrs[key] && currentAttrs[key] !== 0 && !newAttr[key] && newAttr[key] !== 0) {
      return acc
    }
    acc[key] = newAttr[key]
    return acc
  }, {} as T['attrs'])
}

export const addTrackChangesAttributes = (attrs: Attrs, dom: Element) => {
  dom.removeAttribute('data-track-id')
  dom.removeAttribute('data-track-op')
  dom.removeAttribute('data-track-status')

  const changes = attrs.dataTracked as TrackedAttrs[]
  if (!changes || !changes.length) {
    return
  }
  const change = changes[0]
  dom.setAttribute('data-track-id', change.id)
  dom.setAttribute('data-track-op', change.operation)
  dom.setAttribute('data-track-status', change.status)
}

const classNames = new Map([
  [CHANGE_OPERATION.insert, 'inserted'],
  [CHANGE_OPERATION.delete, 'deleted'],
  [CHANGE_OPERATION.set_node_attributes, 'set_attrs'],
])

export const addTrackChangesClassNames = (attrs: Attrs, dom: Element) => {
  dom.classList.remove(...classNames.values())

  const changes = attrs.dataTracked as TrackedAttrs[]
  if (!changes || !changes.length) {
    return
  }
  const change = changes[0]
  const className = classNames.get(change.operation)
  className && dom.classList.add(className)
}

/**
 * Returns descendants that excludes any content in the supplied doc of which external consumers shouldn't be aware. Primarily shadow content.
 */
export function RealDescendants(
  doc: ProsemirrorNode,
  callback: (
    node: ProsemirrorNode,
    pos: number,
    parent: ProsemirrorNode | null,
    index: number
  ) => void | boolean,
  skipDeleted = true
) {
  doc.descendants((...args) => {
    if (isShadowDelete(args[0])) {
      return true
    }
    if (skipDeleted && (isDeleted(args[0]) || isDeletedText(args[0]))) {
      return true
    }
    return callback(...args)
  })
}

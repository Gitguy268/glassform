import { Leaf } from '@glassform/layout'
import type { Size } from '@glassform/layout'

export class MeasuredLeaf extends Leaf {
  private readonly measureFn: () => Size

  constructor(measure: () => Size, options: { measureKey?: unknown } = {}) {
    super(options)
    this.measureFn = measure
  }

  protected override measureLeaf(): Size {
    return this.measureFn()
  }
}

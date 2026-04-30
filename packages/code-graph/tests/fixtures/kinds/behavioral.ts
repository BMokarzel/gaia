// Fixture: comportamentais (method, function, constructor, getter, setter, arrow_function)

class Box {
  private _value = 0;
  constructor(initial: number) {
    this._value = initial;
  }
  get value(): number {
    return this._value;
  }
  set value(v: number) {
    this._value = v;
  }
  static empty(): Box {
    return new Box(0);
  }
}

function add(a: number, b: number): number {
  return a + b;
}

const multiply = async (a: number, b: number): Promise<number> => a * b;

export { Box, add, multiply };

import { Nodes } from './nodes';
import { isValidType } from './types/typeHelpers';

export type Valtype = 'i32' | 'i64' | 'f32' | 'f64' | 'u32' | 'label';

export enum NativeTypes {
  i32 = 'i32',
  i64 = 'i64',
  f32 = 'f32',
  f64 = 'f64',

  anyfunc = 'anyfunc',
  func = 'func',
  void = 'void'
}

export abstract class Type {
  nativeType?: NativeTypes;

  get binaryenType(): Valtype | void {
    switch (this.nativeType) {
      case NativeTypes.i32:
        return 'i32';

      case NativeTypes.f32:
        return 'f32';

      case NativeTypes.f64:
        return 'f64';

      case NativeTypes.func:
      case NativeTypes.i64:
        return 'i64';

      case NativeTypes.void:
        return undefined;

      default:
        throw new Error(`Type ${this} (${this.constructor.name}) returned a undefined binaryenType`);
    }
  }

  equals(otherType: Type) {
    if (!otherType) {
      return false;
    }

    return otherType === this;
  }

  canBeAssignedTo(otherType: Type): boolean {
    if (this.equals(otherType)) {
      return true;
    }

    if (otherType instanceof TypeAlias) {
      return this.canBeAssignedTo(otherType.of);
    }

    if (otherType instanceof UnionType) {
      if (otherType.of.some($ => this.canBeAssignedTo($))) {
        return true;
      }
    }

    if (otherType instanceof AnyType) {
      return true;
    }

    return false;
  }

  abstract toString(): string;
  abstract inspect(levels: number): string;
  abstract schema(): Record<string, Type>;
  abstract getSchemaValue(name: string): any;
}

export function areEqualTypes(typeA: Type | null | void, typeB: Type | null | void): boolean {
  if (!typeA && !typeB) {
    return true;
  }
  if (typeA && typeB && typeA.equals(typeB)) {
    return true;
  }
  return false;
}

export class FunctionType extends Type {
  readonly nativeType: NativeTypes = NativeTypes.func;
  readonly parameterTypes: Type[] = [];
  readonly parameterNames: string[] = [];
  returnType?: Type;

  constructor(public name: Nodes.NameIdentifierNode) {
    super();
  }

  equals(type: Type) {
    if (!type) return false;
    if (!(type instanceof FunctionType)) return false;
    if (this.name !== type.name) return false;
    if (this.parameterTypes.length !== type.parameterTypes.length) return false;
    if (!areEqualTypes(this.returnType, type.returnType)) return false;
    if (this.parameterTypes.some(($, $$) => !areEqualTypes($, type.parameterTypes[$$]))) return false;
    return true;
  }

  toString() {
    const params = this.parameterNames.map(($, ix) => {
      const type = this.parameterTypes && this.parameterTypes[ix];

      return $ + ': ' + (type || '?');
    });

    return `fun(${params.join(', ')}) -> ${this.returnType ? this.returnType : '?'}`;
  }

  inspect(_depth: number) {
    const params = this.parameterNames.map((_, ix) => {
      const type = this.parameterTypes && this.parameterTypes[ix];
      if (!type) {
        return '(?)';
      } else {
        return type.inspect(0);
      }
    });

    return `(fun ${JSON.stringify(this.name.name)} (${params.join(' ')}) ${(this.returnType &&
      this.returnType.inspect(0)) ||
      '?'})`;
  }

  schema() {
    return {};
  }

  getSchemaValue(name: string) {
    throw new Error(`Cannot read schema property ${name} of ${this.inspect(10)}`);
  }
}

export class StructType extends Type {
  nativeType: NativeTypes = NativeTypes.i64;

  constructor(public parameters: Nodes.ParameterNode[]) {
    super();
  }

  equals(type: Type): boolean {
    return type === this;
  }

  toString() {
    return '%struct';
  }

  canBeAssignedTo(otherType: Type) {
    if (super.canBeAssignedTo(otherType)) {
      return true;
    }

    if (RefType.isRefTypeStrict(otherType)) {
      return true;
    }

    return false;
  }

  typeSimilarity(to: Type, depth: number = 1): number {
    if (this.equals(to)) {
      return 1 / depth;
    }

    return 0;
  }

  inspect(level: number) {
    const types =
      level > 1
        ? this.parameters
            .map($ => {
              const type = $.parameterType && TypeHelpers.getNodeType($.parameterType);
              return ' ' + $.parameterName.name + ': ' + (type ? type.inspect(level - 1) : '(?)');
            })
            .join('')
        : '';
    return `(struct${types})`;
  }

  schema() {
    return {
      byteSize: StackType.of('u32', NativeTypes.i32, 4)
    };
  }

  getSchemaValue(name: string) {
    if (name === 'byteSize') {
      return 8;
    }
    throw new Error(`Cannot read schema property ${name} of ${this.inspect(10)}`);
  }
}

export class StackType extends Type {
  private static nativeTypes = new Map<string, StackType>();
  private constructor(public typeName: string, public nativeType: NativeTypes, public byteSize: number) {
    super();
  }

  static of(name: string, nativeType: NativeTypes, byteSize: number): StackType {
    const key = '_' + name + '_' + nativeType + '_' + byteSize;

    let ret = StackType.nativeTypes.get(key);

    if (!ret) {
      ret = new StackType(name, nativeType, byteSize);
      StackType.nativeTypes.set(key, ret);
    }

    return ret;
  }

  equals(other: Type): boolean {
    return other === this;
  }

  canBeAssignedTo(other: Type) {
    const otherType = getUnderlyingTypeFromAlias(other);

    if (
      otherType instanceof StackType &&
      otherType.nativeType === this.nativeType &&
      otherType.typeName === this.typeName &&
      otherType.byteSize === this.byteSize
    ) {
      return true;
    }

    return super.canBeAssignedTo(other);
  }

  toString() {
    return this.typeName;
  }

  inspect() {
    return '(native ' + this.typeName + ')';
  }

  schema() {
    return {
      byteSize: StackType.of('u32', NativeTypes.i32, 4),
      allocationSize: StackType.of('u32', NativeTypes.i32, 4)
    };
  }

  getSchemaValue(name: string) {
    if (name === 'byteSize') {
      return this.byteSize;
    } else if (name === 'allocationSize') {
      return this.byteSize;
    }
    throw new Error(`Cannot read schema property ${name} of ${this.inspect()}`);
  }
}

const u32 = StackType.of('u32', NativeTypes.i32, 4);
const voidType = StackType.of('void', NativeTypes.void, 0);

export class RefType extends Type {
  static instance: RefType = new RefType();
  nativeType: NativeTypes = NativeTypes.i64;

  readonly byteSize = 8;

  protected constructor() {
    super();
  }

  // returns true when otherType is explicityly RefType.instance
  static isRefTypeStrict(otherType: Type) {
    return getUnderlyingTypeFromAlias(otherType) === RefType.instance;
  }

  toString() {
    return 'ref';
  }

  inspect() {
    return '(ref ?)';
  }

  canBeAssignedTo(otherType: Type): boolean {
    return RefType.isRefTypeStrict(otherType);
  }

  typeSimilarity(to: Type, depth: number = 1): number {
    if (this.equals(to)) {
      return 1 / depth;
    }

    return 0;
  }

  equals(otherType: Type): boolean {
    if (!otherType) return false;
    return RefType.isRefTypeStrict(otherType);
  }

  schema() {
    return {
      byteSize: StackType.of('u32', NativeTypes.i32, 4),
      allocationSize: StackType.of('u32', NativeTypes.i32, 4)
    };
  }

  getSchemaValue(name: string) {
    if (name === 'byteSize') {
      return 8;
    } else if (name === 'allocationSize') {
      return 8;
    }
    throw new Error(`Cannot read schema property ${name} of ${this.inspect()}`);
  }
}

export class IntersectionType extends Type {
  nativeType: NativeTypes = NativeTypes.anyfunc;

  constructor(public of: Type[] = []) {
    super();
  }

  toString() {
    if (this.of.length === 0) return '(empty intersection)';
    return this.of.map($ => ($ || '?').toString()).join(' & ');
  }

  inspect(levels: number = 0) {
    return '(intersection ' + this.of.map($ => ($ ? $.inspect(levels - 1) : '(?)')).join(' ') + ')';
  }

  simplify() {
    const newTypes: Type[] = [];
    this.of.forEach($ => {
      if (!newTypes.some($1 => $1.equals($))) {
        newTypes.push($);
      }
    });

    if (newTypes.length === 1) {
      return newTypes[0];
    } else {
      return new IntersectionType(newTypes);
    }
  }

  equals(other: Type): boolean {
    if (!other) return false;
    return (
      other instanceof IntersectionType &&
      this.of.length === other.of.length &&
      this.of.every(($, ix) => areEqualTypes($, other.of[ix]))
    );
  }

  schema() {
    return {};
  }

  getSchemaValue(name: string) {
    throw new Error(`Cannot read schema property ${name} of ${this.inspect(10)}`);
  }
}

export function getUnderlyingTypeFromAlias(type: Type): Type {
  if (type instanceof TypeAlias) {
    return getUnderlyingTypeFromAlias(type.of);
  } else {
    return type;
  }
}

export class UnionType extends Type {
  get binaryenType(): Valtype {
    const nativeTypes = new Set<Valtype>();

    this.of.forEach($ => {
      if (NeverType.isNeverType($)) return;
      nativeTypes.add($.binaryenType as Valtype);
    });

    if (nativeTypes.size === 0) {
      throw new Error('Cannot find a suitable low level type for ' + this.toString() + ' (0)');
    }

    if (nativeTypes.size === 1) {
      return nativeTypes.values().next().value;
    } else {
      throw new Error('Cannot find a suitable low level type for ' + this.toString());
    }
  }

  constructor(public of: Type[] = [], public readonly simplified = false) {
    super();
  }

  static of(x: Type[] | Type): UnionType {
    if (x instanceof UnionType) {
      return x;
    } else if (x instanceof Type) {
      return new UnionType([x], true);
    } else if (x instanceof Array) {
      return new UnionType(x);
    }
    throw new Error('Cannot create UnionType');
  }

  toString() {
    if (this.of.length === 0) return '(empty union)';
    return this.of.map($ => ($ || '?').toString()).join(' | ');
  }

  inspect(levels: number = 0) {
    if (this.of.length === 0) return `(union EMPTY)`;
    return '(union ' + this.of.map($ => ($ ? $.inspect(levels - 1) : '(?)')).join(' ') + ')';
  }

  canBeAssignedTo(otherType: Type) {
    return this.of.every($ => $.canBeAssignedTo(otherType));
  }

  equals(other: Type): boolean {
    if (!other) return false;

    return (
      other instanceof UnionType &&
      this.of.length === other.of.length &&
      this.of.every(($, ix) => areEqualTypes($, other.of[ix]))
    );
  }

  /**
   * This method expands the union type made by other union types into a single
   * union made of the atoms of every member of the initial union. Recursively.
   */
  expand(): Type {
    const newSet = new Set<Type>();

    function add(typeToAdd: Type) {
      const candidate = getUnderlyingTypeFromAlias(typeToAdd);

      if (candidate instanceof UnionType) {
        // If it is an union, we must expand it for each atom
        candidate.of.forEach($ => add($));
      } else {
        // finalize if already present
        if (newSet.has(typeToAdd)) {
          return;
        }
        for (let $ of newSet) {
          // finalize if we already have a type A == B && B == A
          if ($.equals(typeToAdd) && typeToAdd.equals($)) {
            return;
          }
        }
        newSet.add(typeToAdd);
      }
    }

    this.of.forEach(add);

    const newTypes = Array.from(newSet.values());

    return new UnionType(newTypes).simplify();
  }

  /**
   * This method removes an element from the union
   * @param type type to subtract
   */
  subtract(type: Type | null): Type {
    if (!type) return this;
    const removingRefType = RefType.isRefTypeStrict(type);

    if (!this.simplified) {
      return UnionType.of(this.expand()).subtract(type);
    }

    const newSet = new Set<Type>();

    for (let $ of this.of) {
      if ((!removingRefType && RefType.isRefTypeStrict($)) || !$.canBeAssignedTo(type)) {
        newSet.add($);
      }
    }

    if (newSet.size === 0) {
      return InjectableTypes.never;
    }

    const newTypes = Array.from(newSet.values());

    if (newTypes.length === 1) {
      return newTypes[0];
    }

    return new UnionType(newTypes);
  }

  /**
   * This method simplifies the union type. e.g:
   *
   *   type T0 = A | A | A | B
   *   type T0Simplified = A | B
   *
   * It removes types present in unions
   *
   *   type T1 = T0Simplified | B | C | A
   *   type T1Simplified = T0Simplified | C
   *
   *
   */
  simplify() {
    if (this.of.length === 1) {
      return this.of[0];
    }

    let newTypes: Type[] = [];

    this.of.forEach($ => {
      if (NeverType.isNeverType($)) return;

      if (!newTypes.some($1 => areEqualTypes($1, $)) && $) {
        newTypes.push($);
      }
    });

    if (newTypes.length === 0) {
      return InjectableTypes.never;
    }

    let unions: UnionType[] = [];

    function collectUnion($: Type) {
      const candidate = getUnderlyingTypeFromAlias($);

      if (candidate instanceof UnionType) {
        if (!unions.includes(candidate)) {
          unions.push(candidate);
          candidate.of.forEach($ => {
            collectUnion($);
          });
        }
      }
    }

    // Collect unions
    newTypes.forEach(collectUnion);

    // This are the unions that generate some conflict with other unions,
    // therefore we need to expand those unions to the atoms
    const blackListedUnionAtoms: Type[] = [];
    const unionsToRemove: UnionType[] = [];

    // Find the conflictive atoms
    unions.forEach((union, ix) => {
      const expanded = UnionType.of(union.expand());

      const hasConflict = expanded.of.some(atom => unions.some(($, $$) => $$ !== ix && atom.canBeAssignedTo($)));
      if (hasConflict) {
        blackListedUnionAtoms.push(...expanded.of);

        // we are removing the union, it might have elements not present in the
        // newTypes, we add them
        expanded.of.forEach($ => {
          if (!newTypes.some($1 => $1.equals($))) {
            newTypes.push($);
          }
        });
        unionsToRemove.push(union);
      }
    });

    unions = unions.filter($ => !unionsToRemove.includes($));

    // Eliminate types present in unions
    newTypes.forEach((newType, i) => {
      const candidate = getUnderlyingTypeFromAlias(newType);

      if (unionsToRemove.includes(candidate as any)) {
        (newTypes as any)[i] = null;
        return;
      }

      if (RefType.isRefTypeStrict(candidate) || blackListedUnionAtoms.some(x => candidate.canBeAssignedTo(x))) {
        return;
      }

      if (unions.some(union => !union.equals(candidate) && candidate.canBeAssignedTo(union))) {
        (newTypes as any)[i] = null;
      }
    });

    // Remove eliminated types
    newTypes = newTypes.filter($ => !!$);

    if (newTypes.length === 1) {
      return newTypes[0];
    } else {
      return new UnionType(newTypes, true);
    }
  }

  schema() {
    return {
      byteSize: u32
    };
  }

  getSchemaValue(name: string) {
    if (name === 'byteSize') {
      const nativeTypes = new Set<number>();

      this.of.forEach($ => {
        if (NeverType.isNeverType($)) return;
        nativeTypes.add($.getSchemaValue('byteSize'));
      });

      if (nativeTypes.size === 0) {
        throw new Error('Cannot find a consistent byteSize in ' + this.inspect(100) + ' (0)');
      }

      if (nativeTypes.size === 1) {
        return nativeTypes.values().next().value;
      } else {
        throw new Error('Cannot find a consistent byteSize in ' + this.inspect(100));
      }
    } else if (name === 'allocationSize') {
      return 8;
    }
    throw new Error(`Cannot read schema property ${name} of ${this.inspect(10)}`);
  }
}

export class TypeAlias extends Type {
  get binaryenType() {
    return this.of.binaryenType;
  }

  get nativeType(): NativeTypes {
    return this.of.nativeType as NativeTypes;
  }

  discriminant: number | null = null;

  constructor(public name: Nodes.NameIdentifierNode, public readonly of: Type) {
    super();
  }

  canBeAssignedTo(other: Type) {
    return this.of.canBeAssignedTo(other);
  }

  equals(other: Type): boolean {
    if (!(other instanceof TypeAlias)) return false;
    if (other.name !== this.name) return false;
    if (other.discriminant !== this.discriminant) return false;
    if (!areEqualTypes(this.of, other.of)) return false;

    return true;
  }

  toString(): string {
    return this.name.name;
  }

  inspect(levels: number = 0) {
    const ofString = levels > 0 ? ' ' + (this.of ? this.of.inspect(levels - 1) : '(?)') : '';
    return `(alias ${this.name.name}${ofString})`;
  }

  schema() {
    const result: Record<string, Type> = {
      ...this.of.schema(),
      discriminant: u32
    };

    const baseType = getUnderlyingTypeFromAlias(this);

    if (baseType instanceof StructType) {
      result['allocationSize'] = u32;

      const properties = this.getOrderedProperties();

      properties.forEach(prop => {
        result[`property$${prop.index}_offset`] = u32;
        result[`property$${prop.index}_allocationSize`] = u32;
      });
    }

    return result;
  }

  getSchemaValue(name: string) {
    if (name === 'discriminant') {
      if (this.discriminant === null) {
        throw new Error('empty discriminant');
      }
      return this.discriminant;
    } else {
      const baseType = getUnderlyingTypeFromAlias(this);
      if (baseType instanceof StructType) {
        if (name === 'allocationSize') {
          const properties = this.getOrderedProperties();

          let offset = 0;

          for (let prop of properties) {
            const fn = getNonVoidFunction(TypeHelpers.getNodeType(prop.name) as IntersectionType);
            offset += fn!.returnType!.getSchemaValue('byteSize');
          }

          return offset;
        } else if (name.startsWith('property$')) {
          const properties = this.getOrderedProperties();
          const index = parseInt(name.substr('property$'.length), 10);
          const property = properties.find($ => $.index === index);

          if (!property) {
            throw new Error('cannot find property index ' + index);
          }

          if (name.endsWith('_offset')) {
            let offset = 0;

            for (let prop of properties) {
              if (prop.index === index) {
                break;
              }
              const fn = getNonVoidFunction(TypeHelpers.getNodeType(prop.name) as IntersectionType);
              offset += fn!.returnType!.getSchemaValue('allocationSize');
            }

            return offset;
          } else if (name.endsWith('_allocationSize')) {
            const fn = getNonVoidFunction(TypeHelpers.getNodeType(property.name) as IntersectionType);
            return fn!.returnType!.getSchemaValue('allocationSize');
          }
        }
      }
    }
    return this.of.getSchemaValue(name);
  }

  private getOrderedProperties() {
    const properties: Array<{ index: number; name: Nodes.NameIdentifierNode }> = [];

    this.name.namespaceNames &&
      this.name.namespaceNames.forEach((nameIdentifierNode, name) => {
        if (name.startsWith('property$')) {
          const index = parseInt(name.substr('property$'.length), 10);
          properties.push({ index, name: nameIdentifierNode });
        }
      });

    properties.sort((a, b) => {
      if (a.index > b.index) {
        return 1;
      } else {
        return -1;
      }
    });

    return properties;
  }
}

function getNonVoidFunction(type: IntersectionType): FunctionType | null {
  const functions = type.of as FunctionType[];
  for (let fn of functions) {
    if (fn.returnType && !voidType.canBeAssignedTo(fn.returnType)) {
      return fn;
    }
  }
  return null;
}

export class TypeType extends Type {
  static memMap = new WeakMap<Type, TypeType>();
  private constructor(public readonly of: Type) {
    super();
  }

  static of(of: Type) {
    let ret = this.memMap.get(of);
    if (!ret) {
      ret = new TypeType(of);
      this.memMap.set(of, ret);
    }
    return ret;
  }

  canBeAssignedTo(other: Type): boolean {
    const otherType = getUnderlyingTypeFromAlias(other);
    if (otherType instanceof TypeType) {
      return this.of.canBeAssignedTo(otherType.of);
    }
    return false;
  }

  equals(other: Type): boolean {
    if (!other) return false;
    return other instanceof TypeType && areEqualTypes(other.of, this.of);
  }

  inspect(levels: number = 0) {
    return `(type ${this.of.inspect(levels - 1)})`;
  }

  toString() {
    return `Type<${this.of}>`;
  }

  schema() {
    return this.of.schema();
  }

  getSchemaValue(name: string) {
    return this.of.getSchemaValue(name);
  }
}

// https://en.wikipedia.org/wiki/Bottom_type
// https://en.wikipedia.org/wiki/Fail-stop
export class NeverType extends Type {
  static isNeverType(otherType: Type) {
    return getUnderlyingTypeFromAlias(otherType) instanceof NeverType;
  }

  get nativeType() {
    return NativeTypes.void;
  }

  toString(): string {
    return 'never';
  }

  inspect(): string {
    return '(never)';
  }

  equals(other: Type) {
    if (NeverType.isNeverType(other)) {
      return true;
    }
    if (other instanceof UnionType) {
      if (other.of.length === 0) {
        return true;
      }
      if (other.of.length === 1 && this.equals(other.of[0])) {
        return true;
      }
    }
    return super.equals(other);
  }

  canBeAssignedTo(_: Type) {
    return true;
  }

  schema() {
    return {};
  }

  getSchemaValue(name: string) {
    throw new Error(`Cannot read schema property ${name} of ${this.inspect()}`);
  }
}

// https://en.wikipedia.org/wiki/Top_type
export class AnyType extends Type {
  get nativeType() {
    return NativeTypes.anyfunc;
  }

  toString(): string {
    return 'any';
  }

  inspect(): string {
    return '(any)';
  }

  canBeAssignedTo(_: Type) {
    return false;
  }

  schema() {
    return {};
  }
  getSchemaValue(name: string) {
    throw new Error(`Cannot read schema property ${name} of ${this.inspect()}`);
  }
}

export const InjectableTypes = Object.assign(Object.create(null) as unknown, {
  void: voidType,
  ref: RefType.instance,
  never: new NeverType(),
  AnyType: TypeType.of(new AnyType()),
  Any: new AnyType()
});

export const UNRESOLVED_TYPE = new NeverType();

export namespace TypeHelpers {
  const ofTypeSymbol = Symbol('ofType');

  export function getNodeType(node: Nodes.Node): Type | null {
    return (node as any)[ofTypeSymbol] || null;
  }

  export function setNodeType(node: Nodes.Node, type: Type | null): void {
    (node as any)[ofTypeSymbol] = type;

    node.isTypeResolved = isValidType(type);
  }
}

import { Path, PathUtil } from 'app/modules/editor/model/paths';

import { Property } from './Property';

export class PathProperty extends Property<Path> {
  // @Override
  setEditableValue(model: any, propertyName: string, value: string) {
    let path: Path;
    try {
      path = new Path(value);
    } catch (e) {
      // An error will be thrown if the user attempts to enter an invalid path,
      // which will occur frequently if they type the path out by hand.
      return;
    }
    model[propertyName] = path;
  }

  // @Override
  getEditableValue(model: any, propertyName: string) {
    return model[propertyName] ? model[propertyName].getPathString() : '';
  }

  // @Override
  protected getter(model: any, propertyName: string): Path {
    return model[`${propertyName}_`];
  }

  // @Override
  protected setter(model: any, propertyName: string, value: Path | string) {
    if (!value) {
      model[`${propertyName}_`] = undefined;
      return;
    }
    model[`${propertyName}_`] = typeof value === 'string' ? new Path(value) : value;
  }

  // @Override
  displayValueForValue(value: Path) {
    return value ? value.getPathString() : '';
  }

  // @Override
  interpolateValue(start: Path, end: Path, fraction: number) {
    if (!start || !end || !start.isMorphableWith(end) || !fraction) {
      return start;
    }
    if (fraction === 1) {
      return end;
    }
    return PathUtil.interpolate(start, end, fraction);
  }

  // @Override
  cloneValue(value: Path) {
    return value ? value.mutate().build() : undefined;
  }

  // @Override
  getAnimatorValueType() {
    return 'pathType';
  }

  // @Override
  getTypeName() {
    return 'PathProperty';
  }
}

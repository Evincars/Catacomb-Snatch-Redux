/** The few yuka classes the computer players steer with; the library ships no type declarations. */
declare module 'yuka' {
  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
  }
  export class Path {
    loop: boolean;
    add(waypoint: Vector3): this;
    clear(): this;
    current(): Vector3;
    finished(): boolean;
    advance(): this;
  }
  export class SteeringBehavior {
    active: boolean;
    weight: number;
  }
  export class FollowPathBehavior extends SteeringBehavior {
    path: Path;
    nextWaypointDistance: number;
    constructor(path?: Path, nextWaypointDistance?: number);
  }
  export class SeparationBehavior extends SteeringBehavior {}
  export class Vehicle {
    position: Vector3;
    velocity: Vector3;
    maxSpeed: number;
    maxForce: number;
    neighbors: Vehicle[];
    steering: {
      add(behavior: SteeringBehavior): unknown;
      calculate(delta: number, result: Vector3): Vector3;
    };
  }
}

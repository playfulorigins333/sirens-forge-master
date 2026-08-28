export const LEGACY_TRAINER_SELECTION_LIMITS=Object.freeze({minimum:10,maximum:20});
export function trainerSelectionCapacityError(count:number,durableEnabled:boolean): "TRAINER_EXECUTION_SELECTION_LIMIT"|null {
 return !durableEnabled && (count<LEGACY_TRAINER_SELECTION_LIMITS.minimum||count>LEGACY_TRAINER_SELECTION_LIMITS.maximum) ? "TRAINER_EXECUTION_SELECTION_LIMIT" : null;
}
export const TRAINER_EXECUTION_SELECTION_LIMIT_MESSAGE="Current Trainer execution requires 10–20 selected images. Adjust your selection and let Dataset Doctor review it again.";

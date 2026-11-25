/**
 * OMR (optical mark recognition) answer-sheet reader.
 *
 * Status: PLANNED — NOT IMPLEMENTED. Nothing in the app reads paper answer sheets yet;
 * students answer quizzes on the phone and the server scores them.
 *
 * Planned approach:
 * 1. Print a fixed CMS answer sheet with four corner markers, a QR code with the quiz id,
 *    and a known bubble grid.
 * 2. Take a photo with the camera, find the markers and straighten the image.
 * 3. Measure each bubble's darkness; the darkest bubble above a threshold is the answer
 *    (two dark bubbles = invalid).
 * 4. Send the answers to the same `submit_quiz` scoring used by the phone quiz.
 * Steps 2–3 need native image processing (e.g. a VisionCamera frame processor or OpenCV),
 * which requires a custom development build instead of Expo Go.
 */
export const OMR_STATUS = 'planned' as const;

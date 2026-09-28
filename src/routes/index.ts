import { Router } from "express";
import healthRouter from "./health";
import ordersRouter from "./orders";
import confirmRouter from "./confirm";
import locationRouter from "./location";
import ridersRouter from "./riders";

const router = Router();

router.use("/health", healthRouter);
router.use("/riders", ridersRouter);
router.use("/orders", ordersRouter);
router.use("/orders", confirmRouter);
router.use("/orders", locationRouter);

export default router;

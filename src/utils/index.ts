import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)


export { execAsync }

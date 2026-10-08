package sh.kivotos.trace

import android.os.Trace
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KivotosNativeTraceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KivotosNativeTrace")

    Function("beginSection") { name: String ->
      Trace.beginSection(name.take(127))
    }

    Function("endSection") {
      Trace.endSection()
    }
  }
}

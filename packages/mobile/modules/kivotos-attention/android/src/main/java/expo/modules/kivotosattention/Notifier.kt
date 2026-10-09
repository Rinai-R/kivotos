package expo.modules.kivotosattention

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * System notifications for attention frames. Channels are high importance,
 * so Android shows them as heads-up pop-ups over other apps.
 */
object Notifier {
  const val CHANNEL_ATTENTION = "attention"
  const val CHANNEL_RESULTS = "results"
  const val CHANNEL_SERVICE = "service"
  const val EXTRA_MACHINE = "kivotos.machine"
  const val EXTRA_SESSION = "kivotos.session"
  /** Logo blue (#3478DB), the accent of expanded notifications. */
  private const val BRAND_BLUE = 0xFF3478DB.toInt()

  private val zh: Boolean get() = Locale.getDefault().language == "zh"

  private fun text(en: String, zhText: String) = if (zh) zhText else en

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ATTENTION,
        text("Approvals and questions", "审批与提问"),
        NotificationManager.IMPORTANCE_HIGH,
      ).apply { description = text("A session is waiting for you", "会话正在等你处理") },
    )
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_RESULTS,
        text("Finished tasks", "任务完成"),
        NotificationManager.IMPORTANCE_HIGH,
      ).apply { description = text("A session finished or failed", "会话已完成或失败") },
    )
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_SERVICE,
        text("Connection", "连接"),
        NotificationManager.IMPORTANCE_MIN,
      ).apply {
        description = text("Keeps Kivotos connected to your machines", "保持 Kivotos 与各机器的连接")
        setShowBadge(false)
      },
    )
  }

  /** The ongoing notification the foreground service must show. */
  fun serviceNotification(context: Context, connected: Int, total: Int) =
    NotificationCompat.Builder(context, CHANNEL_SERVICE)
      .setSmallIcon(R.drawable.kivotos_notification)
      .setContentTitle(text("Watching $connected of $total machines", "正在关注 $connected/$total 台机器"))
      .setContentIntent(openIntent(context, null, null, 0))
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .build()

  /** Post (or replace) the notification for one frame. */
  fun post(context: Context, machine: Machine, frame: AttentionFrame) {
    if (!canPost(context)) return
    val title = frame.title.ifEmpty { text("Session", "会话") }
    val (channel, headline) = when (frame.kind) {
      "approval" -> CHANNEL_ATTENTION to text("Approval needed", "需要审批")
      "question" -> CHANNEL_ATTENTION to text("Question for you", "有问题等你回答")
      "done" -> CHANNEL_RESULTS to text("Task finished", "任务完成")
      "failed" -> CHANNEL_RESULTS to text("Task failed", "任务失败")
      else -> return
    }
    val id = notificationId(machine.id, frame.sessionId, frame.key)
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.drawable.kivotos_notification)
      .setContentTitle("$headline · $title")
      .setContentText(frame.detail.ifEmpty { machine.name })
      .setSubText(machine.name)
      .setStyle(NotificationCompat.BigTextStyle().bigText(frame.detail.ifEmpty { machine.name }))
      .setContentIntent(openIntent(context, machine.id, frame.sessionId, id))
      .setAutoCancel(true)
      .setColor(BRAND_BLUE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setDefaults(NotificationCompat.DEFAULT_ALL)
      .setCategory(
        if (channel == CHANNEL_ATTENTION) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS,
      )
      .setGroup("kivotos.${machine.id}.${frame.sessionId}")
    @Suppress("MissingPermission")
    NotificationManagerCompat.from(context).notify(id, builder.build())
  }

  /** Withdraw the approval/question notification a `resolved` frame settles. */
  fun cancel(context: Context, machineId: String, sessionId: String, key: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(machineId, sessionId, key))
  }

  /** Withdraw every notification of a session the user has just opened. */
  fun cancelSession(context: Context, machineId: String, sessionId: String) {
    val manager = context.getSystemService(NotificationManager::class.java)
    val group = "kivotos.$machineId.$sessionId"
    manager.activeNotifications.filter { it.notification.group == group }.forEach { manager.cancel(it.id) }
  }

  private fun canPost(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED

  private fun notificationId(machineId: String, sessionId: String, key: String) =
    "$machineId|$sessionId|$key".hashCode()

  private fun openIntent(context: Context, machineId: String?, sessionId: String?, requestCode: Int): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (machineId != null && sessionId != null) {
      launch.putExtra(EXTRA_MACHINE, machineId).putExtra(EXTRA_SESSION, sessionId)
    }
    return PendingIntent.getActivity(
      context,
      requestCode,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}

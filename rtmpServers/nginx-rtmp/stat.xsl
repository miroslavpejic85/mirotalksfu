<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="/">
        <html>
            <body>
                <h1>RTMP Statistics</h1>
                <table border="none">
                    <tr bgcolor="#9acd32">
                        <th>Stream</th>
                        <th>Bitrate (kbps)</th>
                        <th>Bytes</th>
                        <th>Client</th>
                        <th>BW (kbps)</th>
                        <th>Time</th>
                    </tr>
                    <xsl:for-each select="rtmp/server/application/live/">
                        <tr>
                            <td><xsl:value-of select="@name"/></td>
                            <td><xsl:value-of select="bw_in_video"/></td>
                            <td><xsl:value-of select="bytes"/></td>
                            <td><xsl:value-of select="client_ip"/></td>
                            <td><xsl:value-of select="bw_out_video"/></td>
                            <td><xsl:value-of select="time"/></td>
                        </tr>
                    </xsl:for-each>
                </table>
            </body>
        </html>
    </xsl:template>
</xsl:stylesheet>


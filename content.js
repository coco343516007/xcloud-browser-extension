(() => {
  "use strict";

  const TARGET_HASH_PREFIX = ["#/siteCloud/hostDetail", "#/network/safeDetail"];
  const COLUMN_CLASS = "xinnet-remark-column";
  const PREFERRED_COLUMN_WIDTH = 220;
  const MIN_COLUMN_WIDTH = 140;
  const SECURITY_GROUP_CODE_PATTERN = /^[a-f0-9]{32}$/i;
  const RULES_API_PATTERN = /\/api\/security\/group\/rules\/([a-f0-9]{32})(?:[/?#]|$)/i;

  let rules = [];
  let hasLoaded = false;
  let loadError = null;
  let fetchPromise = null;
  let activeSecurityGroupCode = null;
  let requestSequence = 0;
  let scheduled = false;
  let lastUrl = location.href;

  function isTargetPage() {
    return TARGET_HASH_PREFIX.some((prefix) => location.hash.startsWith(prefix));
  }

  function getSecurityGroupCode() {
    const queryIndex = location.hash.indexOf("?");
    if (queryIndex >= 0) {
      const params = new URLSearchParams(location.hash.slice(queryIndex + 1));
      const code = params.get("securityGroupCode");
      if (code && SECURITY_GROUP_CODE_PATTERN.test(code)) {
        return code;
      }
    }

    // hostDetail does not put the security-group code in its URL. Its own
    // rules request is a same-origin resource entry, including after the user
    // switches the selected security group.
    const resources = performance.getEntriesByType("resource");
    for (let index = resources.length - 1; index >= 0; index -= 1) {
      const match = resources[index].name.match(RULES_API_PATTERN);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  function normalized(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function ruleKey(priority, protocol, port, ipRange, createTime) {
    return [priority, protocol, port, ipRange, createTime].map(normalized).join("\u0001");
  }

  function getRuleKey(rule) {
    return ruleKey(rule.priority, rule.protocolType, rule.dstPort, rule.ipRange, rule.createTime);
  }

  function getCellValue(cell) {
    const ellipsisText = cell.querySelector(".ivu-ellipsis-text");
    if (ellipsisText) {
      return ellipsisText.textContent;
    }

    const tooltipText = cell.querySelector(".ivu-table-cell-tooltip-content");
    if (tooltipText) {
      return tooltipText.textContent;
    }

    return cell.innerText || cell.textContent;
  }

  function getRowKey(row, layout) {
    const cells = Array.from(row.children).filter((cell) => !cell.classList.contains(COLUMN_CLASS));

    const indexes = [
      layout.priorityIndex,
      layout.protocolIndex,
      layout.portIndex,
      layout.ipRangeIndex,
      layout.createTimeIndex,
    ];

    if (indexes.some((index) => index < 0 || index >= cells.length)) {
      return null;
    }

    return ruleKey(
      getCellValue(cells[layout.priorityIndex]),
      getCellValue(cells[layout.protocolIndex]),
      getCellValue(cells[layout.portIndex]),
      getCellValue(cells[layout.ipRangeIndex]),
      getCellValue(cells[layout.createTimeIndex]),
    );
  }

  function getRemarkMap() {
    const map = new Map();

    for (const rule of rules) {
      const key = getRuleKey(rule);
      if (!map.has(key)) {
        map.set(key, rule.remark ?? "");
      }
    }

    return map;
  }

  async function loadRules(securityGroupCode = getSecurityGroupCode()) {
    if (!securityGroupCode) {
      return null;
    }

    if (securityGroupCode === activeSecurityGroupCode && fetchPromise) {
      return fetchPromise;
    }

    activeSecurityGroupCode = securityGroupCode;
    const currentSequence = ++requestSequence;
    hasLoaded = false;
    loadError = null;
    rules = [];
    scheduleRender();

    const currentRequest = fetch(
      `/api/security/group/rules/${encodeURIComponent(securityGroupCode)}`,
      {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
      },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`接口请求失败：HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (!payload?.status || !payload?.res) {
          throw new Error(payload?.message || payload?.msg || "接口返回格式异常");
        }

        if (currentSequence !== requestSequence) {
          return;
        }

        rules = [
          ...(Array.isArray(payload.res.ingress) ? payload.res.ingress : []),
          ...(Array.isArray(payload.res.egress) ? payload.res.egress : []),
        ];
        hasLoaded = true;
        loadError = null;
      })
      .catch((error) => {
        if (currentSequence !== requestSequence) {
          return;
        }

        rules = [];
        hasLoaded = true;
        loadError = error instanceof Error ? error.message : String(error);
        console.warn("[新网安全组规则备注]", error);
      })
      .finally(() => {
        if (currentSequence === requestSequence) {
          fetchPromise = null;
          scheduleRender();
        }
      });

    fetchPromise = currentRequest;
    return fetchPromise;
  }

  function syncSecurityGroup() {
    const securityGroupCode = getSecurityGroupCode();
    if (securityGroupCode && securityGroupCode !== activeSecurityGroupCode) {
      loadRules(securityGroupCode);
    }
  }

  function getTableLayout(wrapper) {
    const headerRow = wrapper.querySelector(".ivu-table-header thead tr");
    const headerCells = headerRow
      ? Array.from(headerRow.children).filter((cell) => !cell.classList.contains(COLUMN_CLASS))
      : [];
    const headers = headerCells.map((element) => normalized(element.textContent));
    const operationIndex = headers.indexOf("操作");

    return {
      headerRow,
      priorityIndex: headers.indexOf("优先级"),
      protocolIndex: headers.indexOf("协议类型"),
      portIndex: headers.indexOf("端口范围"),
      ipRangeIndex: headers.indexOf("授权对象"),
      createTimeIndex: headers.indexOf("创建时间"),
      operationIndex,
      remarkIndex: operationIndex >= 0 ? operationIndex : headers.length,
    };
  }

  function isRulesTable(wrapper) {
    const layout = getTableLayout(wrapper);

    return (
      layout.priorityIndex >= 0 &&
      layout.protocolIndex >= 0 &&
      layout.portIndex >= 0 &&
      layout.ipRangeIndex >= 0 &&
      layout.createTimeIndex >= 0
    );
  }

  function ensureColumnElement(row, tagName, insertIndex) {
    let cell = row.querySelector(`:scope > .${COLUMN_CLASS}`);
    if (!cell) {
      cell = document.createElement(tagName);
      cell.className = COLUMN_CLASS;
    }

    const originalCells = Array.from(row.children).filter(
      (element) => !element.classList.contains(COLUMN_CLASS),
    );
    const reference = originalCells[insertIndex] || null;

    if (
      (reference && cell.nextElementSibling !== reference) ||
      (!reference && cell !== row.lastElementChild)
    ) {
      row.insertBefore(cell, reference);
    }

    return cell;
  }

  function setCellContent(cell, value, title = "") {
    let inner = cell.querySelector(":scope > .ivu-table-cell");
    if (!inner) {
      inner = document.createElement("div");
      inner.className = "ivu-table-cell ivu-table-cell-ellipsis";
      cell.replaceChildren(inner);
    }

    if (inner.textContent !== value) {
      inner.textContent = value;
    }

    const nextTitle = title || value;
    if (inner.title !== nextTitle) {
      inner.title = nextTitle;
    }
  }

  function ensureColumnWidth(table, insertIndex, operationIndex) {
    const colgroup = table.querySelector(":scope > colgroup");
    if (!colgroup) {
      return;
    }

    const originalColumns = Array.from(colgroup.children).filter((col) => !col.classList.contains(COLUMN_CLASS));

    for (const col of originalColumns) {
      if (!col.dataset.xinnetOriginalWidth) {
        const width = Number.parseFloat(col.getAttribute("width"));
        if (Number.isFinite(width) && width > 0) {
          col.dataset.xinnetOriginalWidth = String(width);
        }
      }
    }

    let remarkColumn = colgroup.querySelector(`.${COLUMN_CLASS}`);
    if (!remarkColumn) {
      remarkColumn = document.createElement("col");
      remarkColumn.className = COLUMN_CLASS;
    }

    const referenceColumn = originalColumns[insertIndex] || null;
    if (
      (referenceColumn && remarkColumn.nextElementSibling !== referenceColumn) ||
      (!referenceColumn && remarkColumn !== colgroup.lastElementChild)
    ) {
      colgroup.insertBefore(remarkColumn, referenceColumn);
    }

    const tableWidth = Number.parseFloat(table.style.width);
    const originalWidths = originalColumns.map((col) =>
      Number.parseFloat(col.dataset.xinnetOriginalWidth || col.getAttribute("width")),
    );
    const originalTotal = originalWidths.reduce((sum, width) => sum + width, 0);

    if (!Number.isFinite(tableWidth) || tableWidth <= 0 || !Number.isFinite(originalTotal) || originalTotal <= 0) {
      remarkColumn.width = PREFERRED_COLUMN_WIDTH;
      return;
    }

    // The remark column shares the table's existing width. The original
    // columns are reduced proportionally, so the table never becomes wider.
    const fixedIndexes = new Set(operationIndex >= 0 ? [operationIndex] : []);
    const fixedWidth = originalWidths.reduce(
      (sum, width, index) => sum + (fixedIndexes.has(index) ? width : 0),
      0,
    );
    const flexibleTotal = Math.max(0, originalTotal - fixedWidth);
    const flexibleCount = Math.max(1, originalColumns.length - fixedIndexes.size);
    const desiredRemarkWidth = Math.min(
      PREFERRED_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, Math.floor(tableWidth * 0.16)),
    );
    const maxRemarkWidth = Math.max(0, tableWidth - fixedWidth - flexibleCount * 40);
    const remarkWidth = Math.min(desiredRemarkWidth, maxRemarkWidth);
    const availableWidth = Math.max(0, tableWidth - remarkWidth - fixedWidth);
    let assignedWidth = 0;
    const lastFlexibleIndex = originalColumns.reduce(
      (last, _col, index) => (fixedIndexes.has(index) ? last : index),
      -1,
    );

    originalColumns.forEach((col, index) => {
      if (fixedIndexes.has(index)) {
        col.width = originalWidths[index];
        return;
      }

      const isLast = index === lastFlexibleIndex;
      const width = isLast
        ? Math.max(0, availableWidth - assignedWidth)
        : Math.floor((originalWidths[index] / flexibleTotal) * availableWidth);

      col.width = width;
      assignedWidth += width;
    });

    remarkColumn.width = remarkWidth;
  }

  function renderTable(wrapper, remarkMap) {
    wrapper.classList.add("xinnet-remark-enabled");
    const layout = getTableLayout(wrapper);

    for (const table of wrapper.querySelectorAll(".ivu-table-header > table, .ivu-table-body > table")) {
      ensureColumnWidth(table, layout.remarkIndex, layout.operationIndex);
    }

    if (layout.headerRow) {
      const header = ensureColumnElement(layout.headerRow, "th", layout.remarkIndex);
      setCellContent(header, "备注");
    }

    const bodyRows = wrapper.querySelectorAll(".ivu-table-body tbody > tr");
    for (const row of bodyRows) {
      const key = getRowKey(row, layout);
      const cell = ensureColumnElement(row, "td", layout.remarkIndex);

      if (loadError) {
        setCellContent(cell, "加载失败", loadError);
        cell.classList.add("xinnet-remark-error");
        continue;
      }

      cell.classList.remove("xinnet-remark-error");
      if (!hasLoaded) {
        setCellContent(cell, "加载中…");
        continue;
      }

      const remark = key ? remarkMap.get(key) : undefined;
      setCellContent(cell, remark || "—", remark || "无备注");
    }
  }

  function removeColumns() {
    for (const element of document.querySelectorAll(`.${COLUMN_CLASS}`)) {
      element.remove();
    }

    for (const col of document.querySelectorAll("col[data-xinnet-original-width]")) {
      col.width = Number.parseFloat(col.dataset.xinnetOriginalWidth);
      delete col.dataset.xinnetOriginalWidth;
    }

    for (const wrapper of document.querySelectorAll(".xinnet-remark-enabled")) {
      wrapper.classList.remove("xinnet-remark-enabled");
    }
  }

  function render() {
    scheduled = false;

    if (!isTargetPage()) {
      removeColumns();
      return;
    }

    syncSecurityGroup();
    const remarkMap = getRemarkMap();
    const wrappers = Array.from(document.querySelectorAll(".ivu-table-wrapper")).filter(isRulesTable);

    for (const wrapper of wrappers) {
      renderTable(wrapper, remarkMap);
    }
  }

  function scheduleRender() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(render);
  }

  function handleLocationChange() {
    if (location.href === lastUrl) {
      return;
    }

    lastUrl = location.href;
    if (isTargetPage()) {
      syncSecurityGroup();
    }
    scheduleRender();
  }

  const observer = new MutationObserver(() => {
    handleLocationChange();
    scheduleRender();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("hashchange", handleLocationChange);
  window.addEventListener("popstate", handleLocationChange);
  window.addEventListener("resize", scheduleRender);

  if (isTargetPage()) {
    syncSecurityGroup();
  }
  scheduleRender();
})();
